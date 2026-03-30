import numpy as np

class SunEnvironment:
    def __init__(self, altitude_deg, azimuth_deg, DNI, DHI):
        self.altitude_deg = altitude_deg
        self.azimuth_deg = azimuth_deg
        self.DNI = DNI
        self.DHI = DHI
        self.altitude_rad = np.radians(altitude_deg)

    def get_ray_direction(self):
        dx = np.cos(self.altitude_rad)
        dy = -np.sin(self.altitude_rad)
        return np.array([dx, dy])

    def get_GHI(self):
        return self.DNI * np.sin(self.altitude_rad) + self.DHI

    def summary(self):
        print(f"Sun Altitude   : {self.altitude_deg}°")
        print(f"Sun Azimuth    : {self.azimuth_deg}°")
        print(f"DNI            : {self.DNI} W/m²")
        print(f"DHI            : {self.DHI} W/m²")
        print(f"GHI            : {self.get_GHI():.2f} W/m²")
        print(f"Ray Direction  : {self.get_ray_direction()}")
