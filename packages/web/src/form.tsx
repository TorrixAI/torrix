import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Controller, useForm, type DefaultValues, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import type { ReactNode } from "react";
import { ErrorText, Modal } from "./components";

// Shared react-hook-form + zod layer. Schemas validate on submit (and re-validate
// a field once it has errored), matching the server's rules where they matter.
// Controls are the shadcn components so every form shares one implementation.

// Radix Select forbids an empty-string item value; map "" to a sentinel.
const EMPTY_VALUE = "__empty__";

export function useZodForm<T extends FieldValues>(schema: unknown, defaultValues: DefaultValues<T>): UseFormReturn<T> {
  return useForm<T>({
    resolver: standardSchemaResolver(schema as never),
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
  });
}

export function FormModal<T extends FieldValues>({ title, form, onSubmit, onClose, submitLabel = "Save", pending, error, children }: {
  title: string;
  form: UseFormReturn<T>;
  onSubmit: (values: T) => void;
  onClose: () => void;
  submitLabel?: string;
  pending?: boolean;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        {children}
        {error ? <ErrorText>{error}</ErrorText> : null}
        <div className="modal-actions">
          <Button variant="outline" type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
        </div>
      </form>
    </Modal>
  );
}

function messageFor<T extends FieldValues>(form: UseFormReturn<T>, name: Path<T>): string | null {
  const error = form.formState.errors[name];
  if (!error) return null;
  return typeof error.message === "string" ? error.message : "Invalid value";
}

function FieldShell({ label, htmlFor, error, children }: { label: string; htmlFor?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}

export function TextField<T extends FieldValues>({ form, name, label, placeholder, type = "text", inputMode, autoFocus, disabled }: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "numeric" | "decimal" | "email";
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const message = messageFor(form, name);
  const id = `fld-${String(name)}`;
  return (
    <FieldShell label={label} htmlFor={id} error={message}>
      <Input id={id} type={type} inputMode={inputMode} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled} {...form.register(name)} />
    </FieldShell>
  );
}

export function TextAreaField<T extends FieldValues>({ form, name, label, placeholder, rows = 4, autoFocus, disabled }: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  placeholder?: string;
  rows?: number;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const message = messageFor(form, name);
  const id = `fld-${String(name)}`;
  return (
    <FieldShell label={label} htmlFor={id} error={message}>
      <Textarea id={id} rows={rows} placeholder={placeholder} autoFocus={autoFocus} disabled={disabled} {...form.register(name)} />
    </FieldShell>
  );
}

export function SelectField<T extends FieldValues>({ form, name, label, options, disabled }: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  const message = messageFor(form, name);
  const id = `fld-${String(name)}`;
  return (
    <FieldShell label={label} htmlFor={id} error={message}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => {
          const value = typeof field.value === "string" ? field.value : "";
          return (
            <Select value={value === "" ? EMPTY_VALUE : value} onValueChange={(next) => field.onChange(next === EMPTY_VALUE ? "" : next)} disabled={disabled}>
              <SelectTrigger id={id}><SelectValue /></SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option.value || EMPTY_VALUE} value={option.value === "" ? EMPTY_VALUE : option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }}
      />
    </FieldShell>
  );
}

export function CheckField<T extends FieldValues>({ form, name, label }: { form: UseFormReturn<T>; name: Path<T>; label: string }) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex items-center gap-2 text-[13px] text-text-2">
          <Checkbox checked={field.value === true} onCheckedChange={(value) => field.onChange(value === true)} />
          <span>{label}</span>
        </label>
      )}
    />
  );
}
