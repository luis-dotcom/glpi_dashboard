from django.urls import path
from relatorios.views import relatorios_view

urlpatterns = [
    path("", relatorios_view, name="relatorios"),

    
]