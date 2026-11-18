import { useState, type InputHTMLAttributes } from "react";
import { Field } from "./components";
import { Eye, EyeOff } from "lucide-react";
export function PasswordInput({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <Field
      label={label}
      hint={hint}
      action={
        <button
          type="button"
          className="icon-btn"
          aria-label={(visible ? "Ocultar " : "Mostrar ") + label.toLowerCase()}
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      }
    >
      <input
        {...props}
        data-password=""
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        type={visible ? "text" : "password"}
      />
    </Field>
  );
}
