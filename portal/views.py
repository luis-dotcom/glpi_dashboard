import calendar
import re
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests
from django.conf import settings
from django.contrib.auth.decorators import login_required
from django.core.cache import cache
from django.shortcuts import render


SOLVED_OR_CLOSED_STATUSES = {5, 6}

OPEN_BACKLOG_STATUSES = {1, 2, 3, 4}
ASSIGNED_STATUSES = {2, 3}
PENDING_STATUS = 4
RESOLVED_STATUS = 5
CLOSED_STATUS = 6


def glpi_headers(session_token=None):
    headers = {
        "Content-Type": "application/json",
    }

    if session_token:
        headers["Session-Token"] = session_token

    if getattr(settings, "GLPI_APP_TOKEN", ""):
        headers["App-Token"] = settings.GLPI_APP_TOKEN

    return headers


def build_base_context(request):
    return {
        "glpi_name": request.session.get("glpi_name", request.user.username),
        "glpi_profile": request.session.get("glpi_profile", "Sem perfil"),
    }


def normalize_profile_name(value):
    if not value:
        return ""
    return value.strip().lower()


def is_technical_profile(profile_name):
    allowed = getattr(
        settings,
        "GLPI_TECHNICAL_PROFILE_NAMES",
        ["Técnico", "Tecnico", "Super-Admin"],
    )
    normalized_allowed = [normalize_profile_name(item) for item in allowed]
    return normalize_profile_name(profile_name) in normalized_allowed


def parse_glpi_datetime(value):
    if not value:
        return None

    formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue

    return None


def glpi_get_full_session(session_token):
    url = f"{settings.GLPI_API_URL}/getFullSession/"

    try:
        response = requests.get(
            url,
            headers=glpi_headers(session_token),
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=20,
        )

        if response.status_code == 200:
            return response.json()

        return None

    except requests.RequestException:
        return None


def extract_user_id_from_session(full_session):
    if not full_session or not isinstance(full_session, dict):
        return None

    session_data = full_session.get("session", full_session)

    return (
        session_data.get("glpiID")
        or session_data.get("users_id")
        or session_data.get("user_id")
        or session_data.get("id")
    )


def build_month_series():
    return OrderedDict((month, 0) for month in range(1, 13))


def glpi_search_tickets_for_performance(session_token, user_id):
    """
    Busca tickets atribuídos ao técnico trazendo apenas os campos necessários
    para calcular desempenho.
    """

    url = f"{settings.GLPI_API_URL}/search/Ticket"

    params = {
        "reset": "reset",
        "criteria[0][field]": settings.GLPI_TICKET_SEARCH_ASSIGNEE_FIELD_ID,
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": user_id,
        "forcedisplay[0]": settings.GLPI_TICKET_SEARCH_ID_FIELD_ID,
        "forcedisplay[1]": settings.GLPI_TICKET_SEARCH_STATUS_FIELD_ID,
        "forcedisplay[2]": settings.GLPI_TICKET_SEARCH_DATE_FIELD_ID,
        "forcedisplay[3]": settings.GLPI_TICKET_SEARCH_SOLVEDATE_FIELD_ID,
        "forcedisplay[4]": settings.GLPI_TICKET_SEARCH_CLOSEDATE_FIELD_ID,
        "range": "0-9999",
    }

    try:
        response = requests.get(
            url,
            headers=glpi_headers(session_token),
            params=params,
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=40,
        )

        if response.status_code != 200:
            print("Erro GLPI search:", response.text)
            return []

        payload = response.json()
        return payload.get("data", [])

    except requests.RequestException as e:
        print("Erro conexão GLPI:", e)
        return []


def build_performance_data(search_rows, selected_year):
    monthly_captured = build_month_series()
    monthly_resolved = build_month_series()

    assigned_total = len(search_rows)
    assigned_year_total = 0
    pending_total = 0
    closed_this_month = 0

    now = datetime.now()

    status_key = str(settings.GLPI_TICKET_SEARCH_STATUS_FIELD_ID)
    date_key = str(settings.GLPI_TICKET_SEARCH_DATE_FIELD_ID)
    solved_key = str(settings.GLPI_TICKET_SEARCH_SOLVEDATE_FIELD_ID)
    close_key = str(settings.GLPI_TICKET_SEARCH_CLOSEDATE_FIELD_ID)

    for row in search_rows:
        raw_status = row.get(status_key)

        try:
            status = int(raw_status) if raw_status not in (None, "") else None
        except (ValueError, TypeError):
            status = None

        created_at = parse_glpi_datetime(row.get(date_key))
        solved_at = parse_glpi_datetime(row.get(solved_key))
        closed_at = parse_glpi_datetime(row.get(close_key))
        resolved_reference = closed_at or solved_at

        if status not in SOLVED_OR_CLOSED_STATUSES:
            pending_total += 1

        if created_at and created_at.year == selected_year:
            assigned_year_total += 1
            monthly_captured[created_at.month] += 1

        if resolved_reference and resolved_reference.year == selected_year:
            monthly_resolved[resolved_reference.month] += 1

            if (
                resolved_reference.year == now.year
                and resolved_reference.month == now.month
            ):
                closed_this_month += 1

    backlog_values = []
    resolution_rate_values = []

    running_backlog = 0
    for month in range(1, 13):
        running_backlog += monthly_captured[month] - monthly_resolved[month]
        backlog_values.append(running_backlog)

        captured = monthly_captured[month]
        resolved = monthly_resolved[month]

        if captured > 0:
            rate = round((resolved / captured) * 100, 2)
        else:
            rate = 0

        resolution_rate_values.append(rate)

    total_captured_year = sum(monthly_captured.values())
    total_resolved_year = sum(monthly_resolved.values())
    average_monthly_year = round(total_resolved_year / 12, 2)

    history_rows = []
    for month_number in range(1, 13):
        history_rows.append(
            {
                "mes": calendar.month_name[month_number],
                "capturados": monthly_captured[month_number],
                "resolvidos": monthly_resolved[month_number],
                "backlog": backlog_values[month_number - 1],
                "taxa_resolucao": resolution_rate_values[month_number - 1],
            }
        )

    chart_labels = [calendar.month_abbr[m] for m in range(1, 13)]
    chart_captured = list(monthly_captured.values())
    chart_resolved = list(monthly_resolved.values())

    return {
        "assigned_total": assigned_total,
        "assigned_year_total": assigned_year_total,
        "pending_total": pending_total,
        "closed_this_month": closed_this_month,
        "average_monthly_year": average_monthly_year,
        "history_rows": history_rows,
        "chart_labels": chart_labels,
        "chart_captured": chart_captured,
        "chart_resolved": chart_resolved,
        "chart_backlog": backlog_values,
        "chart_resolution_rate": resolution_rate_values,
        "total_captured_year": total_captured_year,
        "total_resolved_year": total_resolved_year,
        "current_backlog": backlog_values[-1] if backlog_values else 0,
        "selected_year": selected_year,
    }


def normalize_login(login_value):
    """
    Consolida:
    luis.porto
    luis.porto_old
    """
    if not login_value:
        return ""

    login_value = login_value.strip().lower()
    login_value = re.sub(r"_old$", "", login_value)
    return login_value


def format_full_name(user_data):
    firstname = (user_data.get("firstname") or "").strip()
    realname = (user_data.get("realname") or "").strip()
    full_name = f"{realname} {firstname}".strip()
    return full_name or user_data.get("name") or "Sem nome"


def glpi_get_profile_name(session_token, profile_id):
    if not profile_id:
        return "Sem perfil"

    try:
        profile_id = int(profile_id)
    except (ValueError, TypeError):
        return str(profile_id)

    cache_key = f"glpi_profile_name_{profile_id}"
    cached = cache.get(cache_key)
    if cached:
        return cached

    url = f"{settings.GLPI_API_URL}/Profile/{profile_id}"

    try:
        response = requests.get(
            url,
            headers=glpi_headers(session_token),
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=20,
        )

        if response.status_code == 200:
            data = response.json()
            profile_name = data.get("name", "Sem perfil")
            cache.set(cache_key, profile_name, 3600)
            return profile_name

    except requests.RequestException:
        pass

    return "Sem perfil"


def glpi_list_users(session_token):
    """
    Lista usuários via search/User.
    Aceita 200 e 206.
    """
    url = f"{settings.GLPI_API_URL}/search/User"
    all_users = []
    start = 0
    step = 100

    while True:
        params = {
            "reset": "reset",
            "forcedisplay[0]": 2,   # id
            "forcedisplay[1]": 1,   # login
            "forcedisplay[2]": 9,   # sobrenome / realname
            "forcedisplay[3]": 34,  # firstname
            "forcedisplay[4]": 20,  # perfil
            "range": f"{start}-{start + step - 1}",
        }

        try:
            response = requests.get(
                url,
                headers=glpi_headers(session_token),
                params=params,
                verify=getattr(settings, "GLPI_VERIFY_SSL", True),
                timeout=30,
            )

            if response.status_code not in (200, 206):
                print("Erro ao listar usuários:", response.status_code, response.text)
                break

            payload = response.json()
            rows = payload.get("data", [])

            if not rows:
                break

            for row in rows:
                all_users.append(
                    {
                        "id": row.get("2"),
                        "name": row.get("1"),
                        "realname": row.get("9"),
                        "firstname": row.get("34"),
                        "profile_name": row.get("20"),
                    }
                )

            total_count = payload.get("totalcount", 0)
            start += step

            if start >= total_count:
                break

        except requests.RequestException as e:
            print("Erro de conexão ao listar usuários:", e)
            break

    print("Total de usuários retornados:", len(all_users))
    return all_users


def glpi_search_tickets_for_user(session_token, user_id):
    url = f"{settings.GLPI_API_URL}/search/Ticket"

    params = {
        "reset": "reset",
        "criteria[0][field]": settings.GLPI_TICKET_SEARCH_ASSIGNEE_FIELD_ID,
        "criteria[0][searchtype]": "equals",
        "criteria[0][value]": user_id,
        "forcedisplay[0]": settings.GLPI_TICKET_SEARCH_ID_FIELD_ID,
        "forcedisplay[1]": settings.GLPI_TICKET_SEARCH_STATUS_FIELD_ID,
        "forcedisplay[2]": settings.GLPI_TICKET_SEARCH_DATE_FIELD_ID,
        "range": "0-9999",
    }

    try:
        response = requests.get(
            url,
            headers=glpi_headers(session_token),
            params=params,
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=40,
        )

        if response.status_code not in (200, 206):
            return []

        payload = response.json()
        rows = payload.get("data", [])

        if rows:
            print("Exemplo row ticket:", rows[0])

        return rows

    except requests.RequestException:
        return []


def summarize_ticket_rows(rows, data_inicio=None, data_fim=None):
    """
    Regras:
    - total: tudo dentro do período
    - atribuidos: status 2,3
    - pendentes: status 4
    - resolvidos: status 5
    - fechados: status 6
    - backlog: status 1,2,3,4
    """
    status_key = str(settings.GLPI_TICKET_SEARCH_STATUS_FIELD_ID)
    date_key = str(settings.GLPI_TICKET_SEARCH_DATE_FIELD_ID)

    metrics = {
        "total": 0,
        "atribuidos": 0,
        "pendentes": 0,
        "resolvidos": 0,
        "fechados": 0,
        "backlog": 0,
    }

    filtering_by_date = bool(data_inicio or data_fim)

    for row in rows:
        raw_date = row.get(date_key)
        opened_at = parse_glpi_datetime(raw_date)

        # se existe filtro por data e não conseguimos ler a data do ticket,
        # não contamos esse ticket
        if filtering_by_date and not opened_at:
            continue

        if opened_at:
            opened_date = opened_at.date()

            if data_inicio and opened_date < data_inicio:
                continue

            if data_fim and opened_date > data_fim:
                continue

        raw_status = row.get(status_key)

        try:
            status = int(raw_status) if raw_status not in (None, "") else None
        except (ValueError, TypeError):
            status = None

        metrics["total"] += 1

        if status in ASSIGNED_STATUSES:
            metrics["atribuidos"] += 1

        if status == PENDING_STATUS:
            metrics["pendentes"] += 1

        if status == RESOLVED_STATUS:
            metrics["resolvidos"] += 1

        if status == CLOSED_STATUS:
            metrics["fechados"] += 1

        if status in OPEN_BACKLOG_STATUSES:
            metrics["backlog"] += 1

    return metrics


def merge_metrics(target, source):
    for key in ("total", "atribuidos", "pendentes", "resolvidos", "fechados", "backlog"):
        target[key] += source.get(key, 0)


def process_single_user(session_token, user_data, data_inicio=None, data_fim=None):
    profile_value = user_data.get("profile_name", "Sem perfil")

    if isinstance(profile_value, list):
        profile_names = [str(item).strip() for item in profile_value if item]
    elif profile_value:
        profile_names = [str(profile_value).strip()]
    else:
        profile_names = ["Sem perfil"]

    normalized_profiles = [item.lower() for item in profile_names]

    if normalized_profiles == ["self-service"]:
        return None

    login_name = user_data.get("name") or ""
    base_login = normalize_login(login_name)

    if not base_login:
        return None

    user_id = user_data.get("id")
    if not user_id:
        return None

    rows = glpi_search_tickets_for_user(session_token, user_id)
    metrics = summarize_ticket_rows(rows, data_inicio=data_inicio, data_fim=data_fim)

    return {
        "base_login": base_login,
        "login_original": login_name,
        "nome_exibicao": format_full_name(user_data),
        "perfil": ", ".join(profile_names),
        "metrics": metrics,
    }


@login_required
def desempenho_view(request):
    context = build_base_context(request)

    profile_name = request.session.get("glpi_profile", "")
    if not is_technical_profile(profile_name):
        context["motivo_bloqueio"] = (
            "Essa área está disponível apenas para colaboradores com perfil técnico."
        )
        return render(request, "portal/sem_permissao.html", context)

    session_token = request.session.get("glpi_session_token")

    ano_atual = datetime.now().year
    ano_param = request.GET.get("ano")

    try:
        selected_year = int(ano_param) if ano_param else ano_atual
    except ValueError:
        selected_year = ano_atual

    available_years = list(range(ano_atual, ano_atual - 5, -1))

    performance_data = {
        "assigned_total": 0,
        "assigned_year_total": 0,
        "pending_total": 0,
        "closed_this_month": 0,
        "average_monthly_year": 0,
        "history_rows": [],
        "chart_labels": [],
        "chart_captured": [],
        "chart_resolved": [],
        "chart_backlog": [],
        "chart_resolution_rate": [],
        "total_captured_year": 0,
        "total_resolved_year": 0,
        "current_backlog": 0,
        "selected_year": selected_year,
        "available_years": available_years,
    }

    if session_token:
        full_session = glpi_get_full_session(session_token)
        user_id = extract_user_id_from_session(full_session)

        if user_id:
            rows = glpi_search_tickets_for_performance(session_token, user_id)
            performance_data = build_performance_data(rows, selected_year)
            performance_data["available_years"] = available_years

    context.update(performance_data)
    return render(request, "portal/desempenho.html", context)


@login_required
def colaboradores_view(request):
    context = build_base_context(request)
    session_token = request.session.get("glpi_session_token")

    data_inicio_str = request.GET.get("data_inicio", "")
    data_fim_str = request.GET.get("data_fim", "")

    data_inicio = parse_date_filter(data_inicio_str)
    data_fim = parse_date_filter(data_fim_str)

    context["data_inicio"] = data_inicio_str
    context["data_fim"] = data_fim_str

    if not session_token:
        context["ranking"] = []
        return render(request, "portal/colaboradores.html", context)

    cache_key = f"portal_colaboradores_ranking_v4_{data_inicio_str}_{data_fim_str}"
    cached = cache.get(cache_key)
    if cached:
        context["ranking"] = cached
        return render(request, "portal/colaboradores.html", context)

    users = glpi_list_users(session_token)
    grouped = {}

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [
            executor.submit(process_single_user, session_token, user, data_inicio, data_fim)
            for user in users
        ]

        for future in as_completed(futures):
            result = future.result()

            if not result:
                continue

            base_login = result["base_login"]
            if not base_login:
                continue

            if base_login not in grouped:
                grouped[base_login] = {
                    "nome": result["nome_exibicao"],
                    "usuarios_consolidados": [],
                    "total": 0,
                    "atribuidos": 0,
                    "pendentes": 0,
                    "resolvidos": 0,
                    "fechados": 0,
                    "backlog": 0,
                }

            grouped[base_login]["nome"] = result["nome_exibicao"]
            grouped[base_login]["usuarios_consolidados"].append(result["login_original"])
            merge_metrics(grouped[base_login], result["metrics"])

    ranking = sorted(grouped.values(), key=lambda item: item["total"], reverse=True)
    ranking = [item for item in ranking if item["total"] > 0]

    cache.set(cache_key, ranking, 300)
    context["ranking"] = ranking
    return render(request, "portal/colaboradores.html", context)


@login_required
def colaborador_view(request):
    context = {
        "glpi_name": request.session.get("glpi_name", request.user.username),
        "glpi_profile": request.session.get("glpi_profile", "Sem perfil"),
    }
    return render(request, "portal/colaborador.html", context)


@login_required
def home_view(request):
    context = {
        "glpi_name": request.session.get("glpi_name", request.user.username),
        "glpi_profile": request.session.get("glpi_profile", "Sem perfil"),
        "glpi_picture": request.session.get("glpi_picture"),
    }
    return render(request, "home.html", context)

def parse_date_filter(value):
    if not value:
        return None

    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None

def summarize_ticket_rows(rows, data_inicio=None, data_fim=None):
    """
    Regras:
    - total: tudo dentro do período
    - atribuidos: status 2,3
    - pendentes: status 4
    - resolvidos: status 5
    - fechados: status 6
    - backlog: status 1,2,3,4
    """
    status_key = str(settings.GLPI_TICKET_SEARCH_STATUS_FIELD_ID)
    date_key = str(settings.GLPI_TICKET_SEARCH_DATE_FIELD_ID)

    metrics = {
        "total": 0,
        "atribuidos": 0,
        "pendentes": 0,
        "resolvidos": 0,
        "fechados": 0,
        "backlog": 0,
    }

    for row in rows:
        opened_at = parse_glpi_datetime(row.get(date_key))

        if opened_at:
            opened_date = opened_at.date()

            if data_inicio and opened_date < data_inicio:
                continue

            if data_fim and opened_date > data_fim:
                continue

        raw_status = row.get(status_key)

        try:
            status = int(raw_status) if raw_status not in (None, "") else None
        except (ValueError, TypeError):
            status = None

        metrics["total"] += 1

        if status in ASSIGNED_STATUSES:
            metrics["atribuidos"] += 1

        if status == PENDING_STATUS:
            metrics["pendentes"] += 1

        if status == RESOLVED_STATUS:
            metrics["resolvidos"] += 1

        if status == CLOSED_STATUS:
            metrics["fechados"] += 1

        if status in OPEN_BACKLOG_STATUSES:
            metrics["backlog"] += 1

    return metrics