from django.urls import path
from .views import home_view, desempenho_view, colaboradores_view

urlpatterns = [
    path("", home_view, name="home"),
    path("desempenho/", desempenho_view, name="desempenho"),
    path("colaboradores/", colaboradores_view, name="colaboradores"),
    
]