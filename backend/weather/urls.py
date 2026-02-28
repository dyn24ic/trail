from django.urls import path
from . import views

urlpatterns = [
    path("predict/", views.predict_hotspots, name="hotspots-predict"),
]
