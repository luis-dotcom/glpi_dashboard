"""
API REST - Backend para o frontend React.
Todas as views retornam JSON.
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response
from django.contrib.auth import get_user_model, login as auth_login, logout as auth_logout

from login.views import (
    glpi_init_session,
    glpi_get_full_session,
    glpi_get_active_profile,
    glpi_extract_user_name,
    glpi_extract_profile_name,
    glpi_get_my_user,
    glpi_extract_picture_url,
    glpi_kill_session,
)
from portal.views import (
    build_performance_data,
    glpi_search_tickets_for_performance,
    glpi_get_full_session as portal_glpi_get_full_session,
    extract_user_id_from_session,
    is_technical_profile,
    glpi_list_users,
    process_single_user,
    merge_metrics,
    parse_date_filter,
)
from relatorios.views import (
    glpi_search_users,
    glpi_get_dropdown,
    glpi_search_tickets,
    build_summary,
    export_excel,
    parse_date as rel_parse_date,
)
from django.core.cache import cache
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

User = get_user_model()


# ============ Auth API ============

@api_view(['POST'])
@permission_classes([AllowAny])
def auth_login_view(request):
    """POST /api/auth/login/ - Autentica via GLPI"""
    username = request.data.get('username', '').strip()
    password = request.data.get('password', '')

    if not username or not password:
        return Response(
            {'error': 'Usuário e senha são obrigatórios'},
            status=status.HTTP_400_BAD_REQUEST
        )

    glpi_session = glpi_init_session(username, password)

    if not glpi_session:
        return Response(
            {'error': 'Usuário ou senha inválidos no GLPI'},
            status=status.HTTP_401_UNAUTHORIZED
        )

    session_token = glpi_session.get('session_token')
    if not session_token:
        return Response(
            {'error': 'Não foi possível iniciar sessão no GLPI'},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    user, _ = User.objects.get_or_create(username=username)
    user.is_active = True
    user.set_unusable_password()
    user.save()

    auth_login(request, user)

    request.session['glpi_session_token'] = session_token
    request.session['glpi_username'] = username

    full_session = glpi_get_full_session(session_token)
    active_profile_data = glpi_get_active_profile(session_token)
    glpi_name = glpi_extract_user_name(full_session, username)
    glpi_profile = glpi_extract_profile_name(active_profile_data)
    user_data = glpi_get_my_user(session_token)
    glpi_picture = glpi_extract_picture_url(user_data)

    request.session['glpi_name'] = glpi_name
    request.session['glpi_profile'] = glpi_profile
    request.session['glpi_picture'] = glpi_picture

    return Response({
        'user': {
            'username': username,
            'name': glpi_name,
            'profile': glpi_profile,
            'picture': glpi_picture,
        }
    })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def auth_logout_view(request):
    """POST /api/auth/logout/ - Encerra sessão"""
    glpi_session_token = request.session.get('glpi_session_token')
    glpi_kill_session(glpi_session_token)

    for key in ['glpi_session_token', 'glpi_username', 'glpi_name', 'glpi_profile', 'glpi_picture']:
        request.session.pop(key, None)

    auth_logout(request)
    return Response({'success': True})


@api_view(['GET'])
@permission_classes([AllowAny])
def auth_me_view(request):
    """GET /api/auth/me/ - Retorna usuário atual ou null se não autenticado"""
    if not request.user.is_authenticated:
        return Response({'user': None})

    return Response({
        'user': {
            'username': request.user.username,
            'name': request.session.get('glpi_name', request.user.username),
            'profile': request.session.get('glpi_profile', 'Sem perfil'),
            'picture': request.session.get('glpi_picture'),
        }
    })


@api_view(['GET'])
@permission_classes([AllowAny])
def auth_csrf_view(request):
    """GET /api/auth/csrf/ - Garante que o cookie CSRF seja definido"""
    return Response({'detail': 'CSRF cookie set'})


# ============ Portal API ============

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_desempenho_view(request):
    """GET /api/portal/desempenho/?ano=2025"""
    profile_name = request.session.get('glpi_profile', '')
    if not is_technical_profile(profile_name):
        return Response(
            {'error': 'Essa área está disponível apenas para colaboradores com perfil técnico.'},
            status=status.HTTP_403_FORBIDDEN
        )

    session_token = request.session.get('glpi_session_token')
    if not session_token:
        return Response({'error': 'Sessão GLPI não encontrada'}, status=status.HTTP_401_UNAUTHORIZED)

    ano_atual = datetime.now().year
    try:
        selected_year = int(request.GET.get('ano', ano_atual))
    except ValueError:
        selected_year = ano_atual

    available_years = list(range(ano_atual, ano_atual - 5, -1))

    full_session = portal_glpi_get_full_session(session_token)
    user_id = extract_user_id_from_session(full_session)

    if not user_id:
        return Response({
            'assigned_total': 0,
            'assigned_year_total': 0,
            'pending_total': 0,
            'closed_this_month': 0,
            'average_monthly_year': 0,
            'history_rows': [],
            'chart_labels': [],
            'chart_captured': [],
            'chart_resolved': [],
            'chart_backlog': [],
            'chart_resolution_rate': [],
            'total_captured_year': 0,
            'total_resolved_year': 0,
            'current_backlog': 0,
            'selected_year': selected_year,
            'available_years': available_years,
        })

        rows, _ = glpi_search_tickets_for_performance(session_token, user_id)
    performance_data = build_performance_data(rows, selected_year)
    performance_data['available_years'] = available_years

    return Response(performance_data)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def portal_colaboradores_view(request, page=None):
    """
    Carrega TODOS os colaboradores do GLPI de uma vez.
    A paginação (1,2,3,4,5...) é feita no frontend para ficar fluida.
    """
    session_token = request.session.get('glpi_session_token')
    if not session_token:
        return Response({'ranking': [], 'total_count': 0, 'data_inicio': '', 'data_fim': ''})

    data_inicio_str = request.GET.get('data_inicio', '')
    data_fim_str = request.GET.get('data_fim', '')
    data_inicio = parse_date_filter(data_inicio_str)
    data_fim = parse_date_filter(data_fim_str)

    cache_key = f"portal_colaboradores_ranking_v6_{data_inicio_str}_{data_fim_str}"
    cached = cache.get(cache_key)
    if cached:
        ranking_full = cached
    else:
        users = glpi_list_users(session_token)
        grouped = {}
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [
                executor.submit(process_single_user, session_token, u, data_inicio, data_fim)
                for u in users
            ]
            for future in as_completed(futures):
                result = future.result()
                if not result:
                    continue
                base_login = result['base_login']
                if not base_login:
                    continue
                if base_login not in grouped:
                    grouped[base_login] = {
                        'nome': result['nome_exibicao'],
                        'usuarios_consolidados': [],
                        'total': 0,
                        'atribuidos': 0,
                        'pendentes': 0,
                        'resolvidos': 0,
                        'fechados': 0,
                        'backlog': 0,
                    }
                grouped[base_login]['nome'] = result['nome_exibicao']
                grouped[base_login]['usuarios_consolidados'].append(result['login_original'])
                merge_metrics(grouped[base_login], result['metrics'])

        ranking_full = sorted(grouped.values(), key=lambda item: item['total'], reverse=True)
        ranking_full = [item for item in ranking_full if item['total'] > 0]
        cache.set(cache_key, ranking_full, 300)

    return Response({
        'ranking': ranking_full,
        'total_count': len(ranking_full),
        'data_inicio': data_inicio_str,
        'data_fim': data_fim_str,
    })


# ============ Relatórios API ============

@api_view(['GET'])
@permission_classes([IsAuthenticated])
def relatorios_filters_view(request):
    """GET /api/relatorios/filters/ - Dropdowns para filtros"""
    session_token = request.session.get('glpi_session_token')
    if not session_token:
        return Response({
            'tecnicos': [],
            'grupos': [],
            'localizacoes': [],
            'categorias': [],
        })

    tecnicos = glpi_search_users(session_token)
    grupos = glpi_get_dropdown('Group', session_token)
    localizacoes = glpi_get_dropdown('Location', session_token)
    categorias = glpi_get_dropdown('ITILCategory', session_token)

    return Response({
        'tecnicos': tecnicos,
        'grupos': grupos,
        'localizacoes': localizacoes,
        'categorias': categorias,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def relatorios_list_view(request):
    """GET /api/relatorios/?data_inicio=&data_fim=&tecnico=&grupo=&localizacao=&categoria="""
    session_token = request.session.get('glpi_session_token')
    if not session_token:
        return Response({
            'page': 1,
            'limit': 20,
            'total': 0,
            'totalPages': 1,
            'data': [],
            'chamados': [],
            'total_chamados': 0,
            'chamados_fechados': 0,
            'chamados_abertos': 0,
            'total_tecnicos': 0,
            'total_grupos': 0,
        })

    data_inicio = rel_parse_date(request.GET.get('data_inicio'))
    data_fim = rel_parse_date(request.GET.get('data_fim'))

    filters = {
        'data_inicio': data_inicio,
        'data_fim': data_fim,
        'tecnico': request.GET.get('tecnico') or '',
        'grupo': request.GET.get('grupo') or '',
        'localizacao': request.GET.get('localizacao') or '',
        'categoria': request.GET.get('categoria') or '',
    }

    page = max(1, int(request.GET.get('page', 1)))
    limit = min(100, max(1, int(request.GET.get('limit', 20))))
    start = (page - 1) * limit

    chamados, total = glpi_search_tickets(session_token, filters, start=start, limit=limit)
    total_pages = max(1, (total + limit - 1) // limit) if total else 1
    summary = build_summary(chamados, filters)

    return Response({
        'page': page,
        'limit': limit,
        'total': total,
        'totalPages': total_pages,
        'data': chamados,
        'chamados': chamados,
        'total_chamados': total,
        **summary,
    })


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def relatorios_export_view(request):
    """GET /api/relatorios/export/?type=excel&data_inicio=&data_fim=&..."""
    session_token = request.session.get('glpi_session_token')
    if not session_token:
        return Response({'error': 'Não autenticado'}, status=status.HTTP_401_UNAUTHORIZED)

    export_type = request.GET.get('type', 'excel')
    data_inicio = rel_parse_date(request.GET.get('data_inicio'))
    data_fim = rel_parse_date(request.GET.get('data_fim'))

    filters = {
        'data_inicio': data_inicio,
        'data_fim': data_fim,
        'tecnico': request.GET.get('tecnico') or '',
        'grupo': request.GET.get('grupo') or '',
        'localizacao': request.GET.get('localizacao') or '',
        'categoria': request.GET.get('categoria') or '',
    }

    chamados, _ = glpi_search_tickets(session_token, filters, start=0, limit=99999)

    if export_type == 'excel':
        response = export_excel(chamados)
        return response

    if export_type == 'pdf':
        from relatorios.views import export_pdf, build_base_context
        context = {
            **build_base_context(request),
            'chamados': chamados,
            'total_chamados': len(chamados),
        }
        return export_pdf(request, context)

    return Response({'error': 'Tipo de exportação inválido'}, status=status.HTTP_400_BAD_REQUEST)
