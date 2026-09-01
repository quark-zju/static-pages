export class OrbitSolverError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "OrbitSolverError";
    this.code = code;
    this.details = details;
  }
}

export const UNSUPPORTED_ORBIT_SUBGROUP = "unsupported-orbit-subgroup";
