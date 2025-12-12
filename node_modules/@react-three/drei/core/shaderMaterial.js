import * as THREE from 'three';

function shaderMaterial(uniforms, vertexShader, fragmentShader, onInit) {
  var _Class;
  return _Class = class extends THREE.ShaderMaterial {
    constructor(parameters) {
      super({
        vertexShader,
        fragmentShader,
        ...parameters
      });
      for (const key in uniforms) {
        this.uniforms[key] = new THREE.Uniform(uniforms[key]);
        Object.defineProperty(this, key, {
          get() {
            return this.uniforms[key].value;
          },
          set(value) {
            this.uniforms[key].value = value;
          }
        });
      }
      this.uniforms = THREE.UniformsUtils.clone(this.uniforms);
      onInit == null || onInit(this);
    }
  }, _Class.key = THREE.MathUtils.generateUUID(), _Class;
}

export { shaderMaterial };
