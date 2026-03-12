"""
URL configuration for main project.
Frontend React em /frontend. API REST em /api/.
"""
from django.contrib import admin
from django.http import JsonResponse
from django.urls import path, include


def health_view(request):
    """GET / - Indica que o backend está rodando."""
    return JsonResponse({
        "status": 200,
        "message": "Backend esta rodando corretamente",
    })


urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('api.urls')),
    path('', health_view),
]
