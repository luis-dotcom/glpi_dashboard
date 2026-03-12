from django.urls import path
from . import views

urlpatterns = [
    path('auth/login/', views.auth_login_view),
    path('auth/logout/', views.auth_logout_view),
    path('auth/me/', views.auth_me_view),
    path('auth/csrf/', views.auth_csrf_view),
    path('portal/desempenho/', views.portal_desempenho_view),
    path('portal/colaboradores/<int:page>/', views.portal_colaboradores_view),
    path('portal/colaboradores/', views.portal_colaboradores_view),
    path('relatorios/filters/', views.relatorios_filters_view),
    path('relatorios/', views.relatorios_list_view),
    path('relatorios/export/', views.relatorios_export_view),
]
