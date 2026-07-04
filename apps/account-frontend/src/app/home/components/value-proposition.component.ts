import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

interface AccountFeature {
  readonly icon: string;
  readonly title: string;
  readonly description: string;
}

@Component({
  selector: 'app-value-proposition',
  imports: [MatIconModule],
  templateUrl: './value-proposition.component.html',
  styleUrl: './value-proposition.component.scss',
})
export class ValuePropositionComponent {
  protected readonly features: readonly AccountFeature[] = [
    {
      icon: 'school',
      title: 'Vínculo estudantil verificável',
      description: 'Confirme a elegibilidade acadêmica uma vez e use esse estado nos serviços CACiC.',
    },
    {
      icon: 'hub',
      title: 'Acesso unificado',
      description: 'Entre com Google e mantenha perfil, permissões e aplicativos autorizados alinhados.',
    },
    {
      icon: 'privacy_tip',
      title: 'Privacidade centralizada',
      description: 'Revise consentimentos, dados pessoais, integrações e solicitações LGPD no mesmo lugar.',
    },
  ];
}
