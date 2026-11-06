import { useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
export function PasswordInput({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId(),
    [visible, setVisible] = useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-control">
        <input
          {...props}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          id={id}
          type={visible ? "text" : "password"}
          aria-describedby={hint ? id + "-hint" : undefined}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={(visible ? "Ocultar " : "Mostrar ") + label.toLowerCase()}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {hint && (
        <small id={id + "-hint"} className="muted">
          {hint}
        </small>
      )}
    </div>
  );
}
