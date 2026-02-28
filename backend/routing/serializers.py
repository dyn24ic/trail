from rest_framework import serializers


class CoordinateSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class RouteRequestSerializer(serializers.Serializer):
    responder_lat = serializers.FloatField(min_value=-90, max_value=90)
    responder_lon = serializers.FloatField(min_value=-180, max_value=180)
    victim_lat = serializers.FloatField(min_value=-90, max_value=90)
    victim_lon = serializers.FloatField(min_value=-180, max_value=180)
    severity = serializers.IntegerField(min_value=1, max_value=5, default=3)
    route_type = serializers.ChoiceField(
        choices=["ground", "helicopter"],
        default="ground",
    )


class TerrainRequestSerializer(serializers.Serializer):
    west = serializers.FloatField(min_value=-180, max_value=180)
    south = serializers.FloatField(min_value=-90, max_value=90)
    east = serializers.FloatField(min_value=-180, max_value=180)
    north = serializers.FloatField(min_value=-90, max_value=90)


class WeatherRequestSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
