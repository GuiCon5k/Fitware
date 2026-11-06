import { useEffect } from "react";
export function useFormGuidance() {
  useEffect(() => {
    const invalid = (event: Event) => {
      const field = event.target as HTMLInputElement;
      if (!field?.validity || !field.setCustomValidity) return;
      const v = field.validity;
      const message = v.valueMissing
        ? "Completá este campo para continuar."
        : v.typeMismatch && field.type === "email"
          ? "Ingresá un email válido, por ejemplo nombre@correo.com."
          : v.tooShort
            ? `Ingresá al menos ${field.minLength} caracteres.`
            : v.tooLong
              ? `Usá hasta ${field.maxLength} caracteres.`
              : v.rangeUnderflow
                ? `El mínimo permitido es ${field.min}.`
                : v.rangeOverflow
                  ? `El máximo permitido es ${field.max}.`
                  : v.stepMismatch
                    ? "Revisá la cantidad o los decimales ingresados."
                    : v.patternMismatch
                      ? field.name === "document"
                        ? "Ingresá entre 6 y 12 números, sin puntos."
                        : "Revisá el formato indicado para este campo."
                      : v.badInput
                        ? "Ingresá un número válido."
                        : "";
      if (message) field.setCustomValidity(message);
      field.setAttribute("aria-invalid", "true");
    };
    const clear = (event: Event) => {
      const field = event.target as HTMLInputElement;
      field?.setCustomValidity?.("");
      field?.removeAttribute?.("aria-invalid");
    };
    document.addEventListener("invalid", invalid, true);
    document.addEventListener("input", clear, true);
    document.addEventListener("change", clear, true);
    return () => {
      document.removeEventListener("invalid", invalid, true);
      document.removeEventListener("input", clear, true);
      document.removeEventListener("change", clear, true);
    };
  }, []);
}
