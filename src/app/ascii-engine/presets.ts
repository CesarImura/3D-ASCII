import * as THREE from "three";

/**
 * Built-in placeholder geometries offered by the "Shape" selector, shown
 * whenever the user hasn't chosen "Custom" (or hasn't uploaded anything yet
 * after choosing it). Kept dependency-free (no textures) so the effect
 * always has something to render.
 */
export type PresetShapeId = "circle" | "square" | "torus";

export function createPresetGeometry(id: PresetShapeId): THREE.BufferGeometry {
  switch (id) {
    case "square":
      return new THREE.BoxGeometry(1.6, 1.6, 1.6);
    case "circle":
      // "Circle" reads most naturally as a round 3D shape (a ball) rather
      // than a flat disc -- a flat disc would show almost no luminance
      // gradient across its face once lit, which defeats the point of an
      // ASCII shading effect. A sphere is the round primitive that actually
      // shows shading detail.
      return new THREE.SphereGeometry(1.2, 48, 32);
    case "torus":
    default:
      return new THREE.TorusGeometry(1, 0.4, 32, 64);
  }
}
