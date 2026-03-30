import numpy as np

class Ray:
    def __init__(self, origin, direction, energy=1.0):
        self.origin = np.array(origin, dtype=float)
        self.direction = np.array(direction, dtype=float)
        self.direction = self.direction / np.linalg.norm(self.direction)
        self.energy = energy
        self.alive = True
        self.history = [self.origin.copy()]

    def propagate(self, distance):
        self.origin = self.origin + self.direction * distance
        self.history.append(self.origin.copy())

    def redirect(self, new_direction, energy_multiplier):
        self.direction = np.array(new_direction, dtype=float)
        self.direction = self.direction / np.linalg.norm(self.direction)
        self.energy *= energy_multiplier

    def kill(self):
        self.alive = False

    def get_path(self):
        pts = np.array(self.history)
        return pts[:, 0], pts[:, 1]


class RayBundle:
    def __init__(self, ray_count, sun_environment, mirror):
        self.rays = []
        self.ray_count = ray_count
        direction = sun_environment.get_ray_direction()
        DNI = sun_environment.DNI

        x_positions = np.linspace(-mirror.D / 2, mirror.D / 2, ray_count)

        for x in x_positions:
            origin = [x, mirror.D * 2]
            energy = DNI / ray_count
            ray = Ray(origin, direction, energy)
            self.rays.append(ray)

    def get_alive_rays(self):
        return [r for r in self.rays if r.alive]

    def get_total_energy(self):
        return sum(r.energy for r in self.rays if r.alive)

    def get_efficiency(self, initial_energy):
        return (self.get_total_energy() / initial_energy) * 100