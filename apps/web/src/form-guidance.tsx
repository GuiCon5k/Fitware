import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { ApiError, type FieldErrors } from "./api";

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type Validator = (
  form: HTMLFormElement,
  submitter: HTMLElement | null,
) => FieldErrors;
type Feedback = {
  fields: Map<HTMLElement, string>;
  message: string;
  client: boolean;
  submitter: HTMLElement | null;
};

const FormFeedback = createContext<Feedback | null>(null);

export function useFieldFeedback(id: string) {
  const feedback = useContext(FormFeedback);
  const field =
    feedback && [...feedback.fields].find(([target]) => target.id === id);
  return {
    message: field?.[1],
    announce: feedback?.fields.size === 1 && !feedback.message,
  };
}

function controls(form: HTMLFormElement): Control[] {
  return Array.from(form.elements).filter(
    (element): element is Control =>
      element.matches("input, select, textarea") &&
      (element as Control).willValidate &&
      !element.closest("[hidden], [inert]"),
  );
}

function targets(form: HTMLFormElement) {
  const eligible = new Set<Element>(controls(form));
  return Array.from(
    form.querySelectorAll<HTMLElement>("[data-validation-field]"),
  ).filter(
    (element) =>
      eligible.has(element) ||
      (element.tagName === "FIELDSET" &&
        !element.closest("[hidden], [inert], fieldset:disabled")),
  );
}

function constraintMessage(control: Control) {
  const { validity, value, type } = control;
  const text = control as HTMLInputElement | HTMLTextAreaElement;
  const hasLength = /^(text|textarea|email|search|tel|url|password)$/.test(
    type,
  );
  const length = hasLength
    ? (control.dataset.password !== undefined || type === "password"
        ? value
        : value.trim()
      ).length
    : 0;
  if (validity.badInput) return "Ingresá un valor válido.";
  if (validity.valueMissing || (control.required && hasLength && length === 0))
    return type === "file" || control.tagName === "SELECT"
      ? "Seleccioná una opción para continuar."
      : "Completá este campo para continuar.";
  if (validity.typeMismatch)
    return type === "email"
      ? "Ingresá un email válido, por ejemplo nombre@correo.com."
      : "Revisá el formato ingresado.";
  if (validity.tooShort || (hasLength && length > 0 && length < text.minLength))
    return `Ingresá al menos ${text.minLength} caracteres.`;
  if (
    validity.tooLong ||
    (hasLength && text.hasAttribute("maxlength") && length > text.maxLength)
  )
    return `Usá hasta ${text.maxLength} caracteres.`;
  if (validity.rangeUnderflow)
    return `El mínimo permitido es ${control.getAttribute("min")}.`;
  if (validity.rangeOverflow)
    return `El máximo permitido es ${control.getAttribute("max")}.`;
  if (validity.stepMismatch)
    return "Revisá la cantidad o los decimales ingresados.";
  if (validity.patternMismatch)
    return control.name === "document"
      ? "Ingresá entre 6 y 12 números, sin puntos."
      : "Revisá el formato indicado para este campo.";
  return validity.valid ? "" : "Revisá este dato.";
}

export function matchPasswords(
  form: HTMLFormElement,
  password: string,
  confirmation: string,
): FieldErrors {
  const data = new FormData(form);
  return data.get(password) !== data.get(confirmation)
    ? {
        [confirmation]:
          "Las contraseñas no coinciden. Escribí la misma contraseña en ambos campos.",
      }
    : {};
}

function fieldName(target: HTMLElement) {
  return target.getAttribute("name") || "";
}

function fieldValue(target: HTMLElement) {
  if (target.tagName === "FIELDSET")
    return Array.from(
      target.querySelectorAll<HTMLInputElement>("input:checked"),
      (input) => input.value,
    ).join("\n");
  const control = target as Control;
  return control.type === "checkbox"
    ? String((control as HTMLInputElement).checked)
    : control.value;
}

function focusFirst(form: HTMLFormElement, fields: Map<HTMLElement, string>) {
  const target = targets(form).find((field) => fields.has(field));
  target?.focus();
}

export function Form({
  children,
  onSubmit,
  onChange,
  validate,
  mapField,
  feedbackScope,
  allowResubmit = false,
  ...props
}: Omit<ComponentPropsWithoutRef<"form">, "onSubmit"> & {
  onSubmit: (
    form: HTMLFormElement,
    submitter: HTMLElement | null,
  ) => void | Promise<void>;
  validate?: Validator;
  mapField?: (path: string) => string;
  feedbackScope?: string | boolean;
  allowResubmit?: boolean;
}) {
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const pending = useRef(false);
  const attempt = useRef(0);
  const shouldFocus = useRef(false);
  useLayoutEffect(() => setFeedback(null), [feedbackScope]);

  function clientErrors(form: HTMLFormElement, submitter: HTMLElement | null) {
    const fields = new Map<HTMLElement, string>();
    const custom = validate?.(form, submitter) || {};
    let message = "";
    for (const control of controls(form)) {
      const error = constraintMessage(control);
      if (!error) continue;
      if (control.hasAttribute("data-validation-field"))
        fields.set(control, error);
      else message = error;
    }
    for (const target of targets(form)) {
      const error = custom[fieldName(target)];
      if (error && !fields.has(target)) fields.set(target, error);
    }
    return { fields, message, client: true, submitter };
  }

  useLayoutEffect(() => {
    if (!feedback || !formRef.current) return;
    const form = formRef.current;
    const active = new Set(targets(form));
    const current = feedback.client
      ? clientErrors(form, feedback.submitter).fields
      : feedback.fields;
    const fields = new Map<HTMLElement, string>();
    for (const target of feedback.fields.keys()) {
      const message = current.get(target);
      if (active.has(target) && message) fields.set(target, message);
    }
    if (
      fields.size !== feedback.fields.size ||
      [...fields].some(
        ([target, message]) => feedback.fields.get(target) !== message,
      )
    ) {
      setFeedback({ ...feedback, fields });
      return;
    }
    if (shouldFocus.current) {
      shouldFocus.current = false;
      focusFirst(form, fields);
    }
  });

  return (
    <form
      {...props}
      ref={formRef}
      noValidate
      onChange={(event) => {
        const changed = event.target as HTMLElement;
        if (feedback) {
          const fields = new Map(
            [...feedback.fields].filter(
              ([target]) => !target.contains(changed),
            ),
          );
          setFeedback({ ...feedback, fields, message: "" });
        }
        onChange?.(event);
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending.current && !allowResubmit) return;
        const form = event.currentTarget;
        const submitter = (event.nativeEvent as SubmitEvent).submitter || null;
        const errors = clientErrors(form, submitter);
        if (errors.fields.size || errors.message) {
          shouldFocus.current = true;
          setFeedback(errors);
          return;
        }
        const submitted = new Map(
          targets(form)
            .filter(fieldName)
            .map((target) => {
              const name = fieldName(target);
              return [name, { target, name, value: fieldValue(target) }];
            }),
        );
        const request = ++attempt.current;
        setFeedback(null);
        pending.current = true;
        try {
          await onSubmit(form, submitter);
        } catch (error) {
          if (!form.isConnected || request !== attempt.current) return;
          const fields = new Map<HTMLElement, string>();
          const unmatched: string[] = [];
          const current = new Set(targets(form));
          const details =
            error instanceof ApiError ? Object.entries(error.fields) : [];
          for (const [path, message] of details) {
            const name = mapField?.(path) ?? path;
            const parent = name.replace(/\.\d+(?:\..*)?$/, "");
            const field = submitted.get(name) || submitted.get(parent);
            if (!field) {
              unmatched.push(message);
              continue;
            }
            const { target } = field;
            if (
              current.has(target) &&
              fieldName(target) === field.name &&
              fieldValue(target) === field.value
            ) {
              const existing = fields.get(target);
              fields.set(target, existing ? existing + " " + message : message);
            }
          }
          const message = details.length
            ? [...new Set(unmatched)].join(" ")
            : error instanceof Error
              ? error.message
              : "No se pudo completar la operación.";
          shouldFocus.current = true;
          setFeedback({ fields, message, client: false, submitter });
        } finally {
          if (request === attempt.current) pending.current = false;
        }
      }}
    >
      {feedback && (feedback.message || feedback.fields.size > 1) && (
        <div className="error form-feedback" role="alert">
          {feedback.fields.size > 1 && (
            <div>Revisá los {feedback.fields.size} campos marcados.</div>
          )}
          {feedback.message}
        </div>
      )}
      <FormFeedback.Provider value={feedback}>{children}</FormFeedback.Provider>
    </form>
  );
}
