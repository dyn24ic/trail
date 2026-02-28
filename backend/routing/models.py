from django.db import models


class RouteRequest(models.Model):
    """Audit log of route calculation requests."""

    created_at = models.DateTimeField(auto_now_add=True)
    responder_lat = models.FloatField()
    responder_lon = models.FloatField()
    victim_lat = models.FloatField()
    victim_lon = models.FloatField()
    severity = models.IntegerField()
    route_type = models.CharField(max_length=20)
    eta_minutes = models.FloatField(null=True, blank=True)
    safety_score = models.FloatField(null=True, blank=True)
    distance_m = models.FloatField(null=True, blank=True)
    helicopter_recommended = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return (
            f"[{self.created_at:%Y-%m-%d %H:%M}] "
            f"{self.route_type} severity={self.severity} "
            f"ETA={self.eta_minutes:.1f}min"
        )
