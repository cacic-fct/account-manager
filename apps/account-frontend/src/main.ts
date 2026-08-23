import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

bootstrapApplication(AppComponent, appConfig).catch((error) => {
  // Let the platform-level error handler/reporting pipeline receive the
  // bootstrap failure without writing arbitrary values to the browser console.
  throw error;
});
