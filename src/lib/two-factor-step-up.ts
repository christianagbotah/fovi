// Browser-only password step-up for sensitive 2FA enrollment.
// The password exists only for the lifetime of the in-flight request: it is
// never written to Web Storage, application state, logs, or URL parameters.

let promptInFlight: Promise<string | null> | null = null;

function cleanupDialog(dialog: HTMLDialogElement, input: HTMLInputElement): void {
  input.value = '';
  if (dialog.open) dialog.close();
  dialog.remove();
}

function buildPasswordDialog(): {
  dialog: HTMLDialogElement;
  input: HTMLInputElement;
  cancelButton: HTMLButtonElement;
  submitButton: HTMLButtonElement;
} {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'fovi-2fa-step-up-title');
  dialog.style.width = 'min(92vw, 420px)';
  dialog.style.border = '1px solid hsl(var(--border))';
  dialog.style.borderRadius = '16px';
  dialog.style.padding = '0';
  dialog.style.background = 'hsl(var(--card))';
  dialog.style.color = 'hsl(var(--card-foreground))';
  dialog.style.boxShadow = '0 24px 80px rgba(0, 0, 0, 0.35)';

  const form = document.createElement('form');
  form.method = 'dialog';
  form.style.padding = '20px';
  form.style.display = 'grid';
  form.style.gap = '14px';

  const title = document.createElement('h2');
  title.id = 'fovi-2fa-step-up-title';
  title.textContent = 'Confirm your password';
  title.style.fontSize = '16px';
  title.style.fontWeight = '700';
  title.style.margin = '0';

  const description = document.createElement('p');
  description.textContent = 'For your security, enter your current password before creating a new authenticator secret.';
  description.style.fontSize = '12px';
  description.style.lineHeight = '1.5';
  description.style.margin = '0';
  description.style.opacity = '0.72';

  const label = document.createElement('label');
  label.textContent = 'Current password';
  label.style.fontSize = '12px';
  label.style.fontWeight = '600';

  const input = document.createElement('input');
  input.type = 'password';
  input.autocomplete = 'current-password';
  input.required = true;
  input.name = 'currentPassword';
  input.style.width = '100%';
  input.style.boxSizing = 'border-box';
  input.style.height = '42px';
  input.style.marginTop = '6px';
  input.style.padding = '0 12px';
  input.style.border = '1px solid hsl(var(--border))';
  input.style.borderRadius = '10px';
  input.style.background = 'hsl(var(--muted))';
  input.style.color = 'inherit';
  input.style.outline = 'none';
  label.appendChild(input);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.justifyContent = 'flex-end';
  actions.style.gap = '8px';
  actions.style.marginTop = '2px';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'Cancel';
  cancelButton.style.height = '38px';
  cancelButton.style.padding = '0 14px';
  cancelButton.style.borderRadius = '9px';
  cancelButton.style.border = '1px solid hsl(var(--border))';
  cancelButton.style.background = 'transparent';
  cancelButton.style.color = 'inherit';
  cancelButton.style.cursor = 'pointer';

  const submitButton = document.createElement('button');
  submitButton.type = 'submit';
  submitButton.textContent = 'Continue';
  submitButton.style.height = '38px';
  submitButton.style.padding = '0 14px';
  submitButton.style.borderRadius = '9px';
  submitButton.style.border = '0';
  submitButton.style.background = 'hsl(var(--primary))';
  submitButton.style.color = 'hsl(var(--primary-foreground))';
  submitButton.style.cursor = 'pointer';

  actions.append(cancelButton, submitButton);
  form.append(title, description, label, actions);
  dialog.appendChild(form);
  return { dialog, input, cancelButton, submitButton };
}

async function promptForCurrentPassword(): Promise<string | null> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (promptInFlight) return promptInFlight;

  const pending = new Promise<string | null>((resolve) => {
    const { dialog, input, cancelButton } = buildPasswordDialog();
    document.body.appendChild(dialog);

    let settled = false;
    const settle = (value: string | null) => {
      if (settled) return;
      settled = true;
      cleanupDialog(dialog, input);
      resolve(value);
    };

    cancelButton.addEventListener('click', () => settle(null));

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      settle(null);
    });

    dialog.addEventListener('close', () => {
      if (!settled) settle(null);
    });

    dialog.querySelector('form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const password = input.value;
      if (!password) {
        input.focus();
        return;
      }
      settle(password);
    });

    dialog.showModal();
    queueMicrotask(() => input.focus());
  });

  promptInFlight = pending;
  try {
    return await pending;
  } finally {
    if (promptInFlight === pending) promptInFlight = null;
  }
}

function isActualTwoFactorSetup(url: string, options: RequestInit): boolean {
  if (!url.includes('/api/auth/two-factor/setup')) return false;
  if ((options.method || 'GET').toUpperCase() !== 'POST') return false;

  // The settings status probe already carries {_check:true}. Any explicit body
  // is preserved exactly as supplied by the caller and never re-prompted.
  return options.body == null;
}

export async function prepareTwoFactorStepUp(
  url: string,
  options: RequestInit,
): Promise<{ options: RequestInit; cancelled: boolean }> {
  if (!isActualTwoFactorSetup(url, options)) {
    return { options, cancelled: false };
  }

  const currentPassword = await promptForCurrentPassword();
  if (!currentPassword) {
    return { options, cancelled: true };
  }

  return {
    options: {
      ...options,
      body: JSON.stringify({ currentPassword }),
    },
    cancelled: false,
  };
}
