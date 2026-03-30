import numpy as np

class ParabolicMirror:
    def __init__(self, focal_length, aperture_diameter, reflectivity, slope_error_deg):
        """
        focal_length       : f in y = x²/4f
        aperture_diameter  : total width of mirror
        reflectivity       : 0 to 1 (e.g. 0.92 for good aluminium mirror)
        slope_error_deg    : manufacturing imperfection in degrees (typically 0.1 to 0.5)
        """
        self.f = focal_length
        self.D = aperture_diameter
        self.reflectivity = reflectivity
        self.slope_error_rad = np.radians(slope_error_deg)

    def get_profile(self, num_points=500):
        """
        Returns x, y arrays of the parabolic curve
        y = x² / 4f
        x ranges from -D/2 to +D/2
        """
        x = np.linspace(-self.D / 2, self.D / 2, num_points)
        y = (x ** 2) / (4 * self.f)
        return x, y

    def get_normal(self, x):
        """
        Returns the surface normal vector at point x on the parabola.
        Derivative of y = x²/4f is dy/dx = x/2f
        Normal is perpendicular to tangent.
        """
        dydx = x / (2 * self.f)
        tangent = np.array([1, dydx])
        tangent = tangent / np.linalg.norm(tangent)
        # normal is perpendicular to tangent
        normal = np.array([-tangent[1], tangent[0]])
        return normal

    def apply_slope_error(self, normal):
        """
        Perturbs normal by a small random angle to simulate manufacturing error.
        """
        error_angle = np.random.normal(0, self.slope_error_rad)
        rotation = np.array([
            [np.cos(error_angle), -np.sin(error_angle)],
            [np.sin(error_angle),  np.cos(error_angle)]
        ])
        return rotation @ normal

    def reflect_ray(self, ray_dir, x):
        """
        Reflects incoming ray_dir off mirror surface at position x.
        Applies reflectivity loss and slope error.
        Returns reflected direction and energy multiplier.
        """
        normal = self.get_normal(x)
        normal = self.apply_slope_error(normal)

        # ensure normal points toward incoming ray
        if np.dot(normal, ray_dir) > 0:
            normal = -normal

        # reflection formula: r = d - 2(d·n)n
        reflected = ray_dir - 2 * np.dot(ray_dir, normal) * normal
        reflected = reflected / np.linalg.norm(reflected)

        return reflected, self.reflectivity

    def get_focal_point(self):
        """Returns the focal point coordinates (0, f) for parabola centered at origin"""
        return np.array([0.0, self.f])
    