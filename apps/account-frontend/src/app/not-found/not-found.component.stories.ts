import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { of } from 'rxjs';
import { NotFoundComponent } from './not-found.component';

const meta: Meta<NotFoundComponent> = {
  title: 'Pages/NotFound',
  component: NotFoundComponent,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<NotFoundComponent>;

export const Default: Story = {};

export const Dark: Story = {
  globals: { theme: 'dark' },
};

export const SignInError: Story = {
  decorators: [
    moduleMetadata({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { signInError: true }, queryParamMap: convertToParamMap({ ref: '7cf0d45b9ec8a123' }) },
            queryParamMap: of(convertToParamMap({ ref: '7cf0d45b9ec8a123' })),
          },
        },
      ],
    }),
  ],
};
