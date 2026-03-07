import requests
from requests.auth import HTTPBasicAuth

from django.conf import settings
from django.contrib import messages
from django.contrib.auth import get_user_model, login as auth_login, logout as auth_logout
from django.contrib.auth.decorators import login_required
from django.shortcuts import redirect, render

from .forms import LoginForm

User = get_user_model()


def glpi_headers(session_token=None):
    headers = {
        "Content-Type": "application/json",
    }

    if session_token:
        headers["Session-Token"] = session_token

    if getattr(settings, "GLPI_APP_TOKEN", ""):
        headers["App-Token"] = settings.GLPI_APP_TOKEN

    return headers


def glpi_init_session(username, password):
    url = f"{settings.GLPI_API_URL}/initSession/"

    try:
        response = requests.get(
            url,
            headers=glpi_headers(),
            auth=HTTPBasicAuth(username, password),
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=15,
        )

        if response.status_code == 200:
            return response.json()

        print("GLPI initSession erro:", response.status_code, response.text)
        return None

    except requests.RequestException as e:
        print("Erro de conexão initSession:", str(e))
        return None


def glpi_get_full_session(session_token):
    url = f"{settings.GLPI_API_URL}/getFullSession/"

    try:
        response = requests.get(
            url,
            headers=glpi_headers(session_token),
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=15,
        )

        if response.status_code == 200:
            return response.json()

        print("GLPI getFullSession erro:", response.status_code, response.text)
        return None

    except requests.RequestException as e:
        print("Erro de conexão getFullSession:", str(e))
        return None


def glpi_get_active_profile(session_token):
    url = f"{settings.GLPI_API_URL}/getActiveProfile/"

    try:
        response = requests.get(
            url,
            headers=glpi_headers(session_token),
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=15,
        )

        if response.status_code == 200:
            data = response.json()
            print("GLPI getActiveProfile retorno:", data)
            return data

        print("GLPI getActiveProfile erro:", response.status_code, response.text)
        return None

    except requests.RequestException as e:
        print("Erro de conexão getActiveProfile:", str(e))
        return None


def glpi_extract_profile_name(active_profile_data):

    if not active_profile_data:
        return "Sem perfil"

    # formato real do GLPI
    if "active_profile" in active_profile_data:
        profile = active_profile_data["active_profile"]
        return profile.get("name", "Sem perfil")

    return "Sem perfil"

def glpi_extract_user_name(full_session, username):
    if not full_session or not isinstance(full_session, dict):
        return username

    session_data = full_session.get("session", full_session)

    realname = session_data.get("glpirealname", "") or ""
    firstname = session_data.get("glpifirstname", "") or ""
    login_name = session_data.get("glpiname", "") or ""

    full_name = f"{firstname} {realname}".strip()

    return (
        full_name
        or session_data.get("name")
        or login_name
        or username
    )


def glpi_get_my_user(session_token):
    """
    Tenta obter os dados do usuário logado no GLPI, incluindo picture.
    """
    full_session = glpi_get_full_session(session_token)
    if not full_session or not isinstance(full_session, dict):
        return None

    session_data = full_session.get("session", full_session)

    user_id = (
        session_data.get("glpiID")
        or session_data.get("glpiID")
        or session_data.get("glpiID_user")
        or session_data.get("glpiID")
    )

    # fallback comum em algumas sessões
    if not user_id:
        user_id = session_data.get("glpiID", None)

    # se ainda não veio, tente por outros nomes comuns
    if not user_id:
        user_id = (
            session_data.get("users_id")
            or session_data.get("user_id")
            or session_data.get("id")
        )

    if not user_id:
        return None

    url = f"{settings.GLPI_API_URL}/User/{user_id}"
    try:
        response = requests.get(
            url,
            headers=glpi_headers(session_token),
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=15,
        )

        if response.status_code == 200:
            return response.json()

        print("GLPI User erro:", response.status_code, response.text)
        return None

    except requests.RequestException as e:
        print("Erro de conexão User:", str(e))
        return None


def glpi_extract_picture_url(user_data):
    if not user_data or not isinstance(user_data, dict):
        return None

    picture = user_data.get("picture")
    if not picture:
        return None

    # Se já vier absoluta, usa direto
    if str(picture).startswith("http://") or str(picture).startswith("https://"):
        return picture

    # Se vier relativa, monta com base na URL do GLPI
    base_url = settings.GLPI_API_URL.replace("/apirest.php", "")
    if str(picture).startswith("/"):
        return f"{base_url}{picture}"

    return f"{base_url}/{picture}"


def glpi_kill_session(session_token):
    if not session_token:
        return

    url = f"{settings.GLPI_API_URL}/killSession/"

    try:
        requests.get(
            url,
            headers=glpi_headers(session_token),
            verify=getattr(settings, "GLPI_VERIFY_SSL", True),
            timeout=15,
        )
    except requests.RequestException:
        pass

def login_view(request):
    if request.user.is_authenticated:
        return redirect("home")

    form = LoginForm(request.POST or None)

    if request.method == "POST" and form.is_valid():
        username = form.cleaned_data["username"].strip()
        password = form.cleaned_data["password"]

        glpi_session = glpi_init_session(username, password)

        if glpi_session:
            session_token = glpi_session.get("session_token")

            if not session_token:
                messages.error(request, "Não foi possível iniciar sessão no GLPI.")
                return render(request, "login.html", {"form": form})

            user, created = User.objects.get_or_create(username=username)
            user.is_active = True
            user.set_unusable_password()
            user.save()

            auth_login(request, user)

            request.session["glpi_session_token"] = session_token
            request.session["glpi_username"] = username

            full_session = glpi_get_full_session(session_token)
            active_profile_data = glpi_get_active_profile(session_token)

            glpi_name = glpi_extract_user_name(full_session, username)
            glpi_profile = glpi_extract_profile_name(active_profile_data)

            user_data = glpi_get_my_user(session_token)
            glpi_picture = glpi_extract_picture_url(user_data)

            request.session["glpi_name"] = glpi_name
            request.session["glpi_profile"] = glpi_profile
            request.session["glpi_picture"] = glpi_picture
            

            return redirect("home")

        messages.error(request, "Usuário ou senha inválidos no GLPI.")

    return render(request, "login.html", {"form": form})


@login_required
def home_view(request):
    context = {
        "glpi_name": request.session.get("glpi_name", request.user.username),
        "glpi_profile": request.session.get("glpi_profile", "Sem perfil"),
        "glpi_picture": request.session.get("glpi_picture"),
    }
    return render(request, "home.html", context)


@login_required
def logout_view(request):
    glpi_session_token = request.session.get("glpi_session_token")
    glpi_kill_session(glpi_session_token)

    request.session.pop("glpi_session_token", None)
    request.session.pop("glpi_username", None)
    request.session.pop("glpi_name", None)
    request.session.pop("glpi_profile", None)
    request.session.pop("glpi_picture", None)

    auth_logout(request)
    return redirect("login")