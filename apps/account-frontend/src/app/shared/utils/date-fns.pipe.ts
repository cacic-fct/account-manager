import { Pipe, type PipeTransform } from '@angular/core';
import { formatLocalizedDate } from './date-fns';

@Pipe({
  name: 'dateFns',
})
export class DateFnsPipe implements PipeTransform {
  transform(value: Date | string | null | undefined, formatString: string, fallback = ''): string {
    return formatLocalizedDate(value, formatString, fallback);
  }
}
