---
name: forms
description: Build a form with React Hook Form + Zod and the @cad/lib.ui form primitives. Use when adding a new form or refactoring an ad-hoc form.
disable-model-invocation: true
---

# Forms

## Stack

- React Hook Form for state.
- Zod for schemas — same schema validates client-side and (re-imported) at
  the API boundary, so duplication is zero.
- `@cad/lib.ui/form` primitives (`<Form>`, `<Field>`, `<TextInput>`,
  `<Select>`, `<DateInput>`, `<FormError>`) for visual consistency.

## Pattern

```typescript
const incidentSchema = z.object({
  title:    z.string().min(3, 'Title is required'),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  location: z.object({ lat: z.number(), lng: z.number() }),
});

type IncidentForm = z.infer<typeof incidentSchema>;

export function OpenIncidentForm({ onSubmit }: { onSubmit: (v: IncidentForm) => Promise<void> }) {
  const form = useForm<IncidentForm>({ resolver: zodResolver(incidentSchema) });
  return (
    <Form onSubmit={form.handleSubmit(onSubmit)}>
      <Field label="Title" error={form.formState.errors.title?.message}>
        <TextInput {...form.register('title')} />
      </Field>
      <Field label="Severity" error={form.formState.errors.severity?.message}>
        <Select {...form.register('severity')} options={SEVERITIES} />
      </Field>
      {/* ... */}
      <Button type="submit" loading={form.formState.isSubmitting}>Open</Button>
    </Form>
  );
}
```

## Server errors

Server returns 400 with `{ errors: { field: 'message' } }`. Use
`form.setError(field, { message })` to surface them inline. Don't dump a
generic toast for field-level errors.

## Don't

- Validate twice with two schemas — keep one Zod schema and re-use it.
- Use `useState` for form state.
- Inline error styling — let `<FormError>` do it; that's the accessibility
  hook.
- Submit on `Enter` in textareas without `Cmd+Enter` discrimination.
