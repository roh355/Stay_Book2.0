import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/auth.service';
import { AuthModalService } from '../../core/auth-modal.service';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'sb-auth-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (modal.open()) {
      <div class="backdrop" (click)="close()">
        <div class="card panel" (click)="$event.stopPropagation()">
          <button class="x" (click)="close()" aria-label="Close">×</button>
          <h3>{{ registerMode() ? 'Create your account' : 'Sign in to book' }}</h3>
          <p class="sub">Bookings are tied to your account.</p>

          <form (ngSubmit)="submit()">
            @if (registerMode()) {
              <label>Name <span class="opt">(optional)</span></label>
              <input class="field" [(ngModel)]="name" name="name" autocomplete="name" />
            }

            <label>Username</label>
            <input
              class="field"
              [(ngModel)]="username"
              name="username"
              autocomplete="username"
              autofocus
            />

            <label>Password</label>
            <input
              class="field"
              type="password"
              [(ngModel)]="password"
              name="password"
              [autocomplete]="registerMode() ? 'new-password' : 'current-password'"
            />

            @if (error()) {
              <p class="err">{{ error() }}</p>
            }

            <button class="btn btn-primary submit" type="submit" [disabled]="busy()">
              {{ busy() ? 'Please wait…' : registerMode() ? 'Create account' : 'Sign in' }}
            </button>
          </form>

          <button class="toggle" (click)="toggleMode()">
            {{ registerMode() ? 'Have an account? Sign in' : 'Need an account? Register' }}
          </button>
          <p class="demo">Demo: <strong>admin / password</strong></p>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .backdrop {
        position: fixed;
        inset: 0;
        background: rgba(2, 6, 23, 0.5);
        -webkit-backdrop-filter: blur(3px);
        backdrop-filter: blur(3px);
        display: grid;
        place-items: center;
        z-index: 1250;
        animation: fade 0.15s ease;
      }
      .card {
        position: relative;
        width: min(92vw, 380px);
        padding: 26px;
        background: var(--paper-solid);
      }
      .x {
        position: absolute;
        top: 16px;
        right: 16px;
        width: 30px;
        height: 30px;
        border-radius: 999px;
        border: 1px solid var(--hairline);
        background: transparent;
        color: var(--ink-2);
        font-size: 18px;
        cursor: pointer;
      }
      .x:hover {
        color: var(--ink);
      }
      h3 {
        font-size: 20px;
      }
      .sub {
        color: var(--ink-2);
        font-size: 13px;
        margin: 4px 0 18px;
      }
      label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        margin: 12px 0 6px;
      }
      .opt {
        color: var(--ink-2);
        font-weight: 400;
      }
      .err {
        color: var(--danger);
        font-size: 13px;
        margin: 12px 0 0;
      }
      .submit {
        width: 100%;
        justify-content: center;
        margin-top: 18px;
        padding: 12px;
      }
      .toggle {
        display: block;
        width: 100%;
        text-align: center;
        margin-top: 14px;
        background: transparent;
        border: none;
        color: var(--slate);
        font-weight: 600;
        font-size: 14px;
        cursor: pointer;
      }
      .demo {
        text-align: center;
        color: var(--ink-2);
        font-size: 13px;
        margin: 10px 0 0;
      }
      @keyframes fade {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
    `,
  ],
})
export class AuthModalComponent {
  protected modal = inject(AuthModalService);
  private auth = inject(AuthService);
  private toast = inject(ToastService);

  protected registerMode = signal(false);
  protected busy = signal(false);
  protected error = signal('');

  username = '';
  password = '';
  name = '';

  toggleMode(): void {
    this.registerMode.update((v) => !v);
    this.error.set('');
  }

  close(): void {
    this.reset();
    this.modal.close();
  }

  async submit(): Promise<void> {
    this.error.set('');
    if (!this.username || !this.password) {
      this.error.set('Enter a username and password.');
      return;
    }
    this.busy.set(true);
    try {
      if (this.registerMode()) {
        await this.auth.register(this.username.trim(), this.password, this.name.trim());
        this.toast.success(`Welcome, ${this.auth.user()?.name}!`);
      } else {
        await this.auth.login(this.username.trim(), this.password);
        this.toast.success(`Signed in as ${this.auth.user()?.name}.`);
      }
      this.reset();
      this.modal.succeeded();
    } catch (e: any) {
      this.error.set(e?.error?.error ?? 'Something went wrong. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  private reset(): void {
    this.username = '';
    this.password = '';
    this.name = '';
    this.error.set('');
    this.registerMode.set(false);
  }
}
