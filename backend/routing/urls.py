from django.urls import path
from . import views

urlpatterns = [
    path("route/calculate/", views.calculate_route_view, name="route-calculate"),
    path("route/compare/", views.compare_routes_view, name="route-compare"),
    path("terrain/", views.terrain_view, name="terrain"),
    path("weather/", views.weather_view, name="weather"),
    path("health/", views.health_view, name="health"),
]
