/** Placeholder `<spite-player>` element. Playback arrives in a later change. */
export class SpitePlayer extends HTMLElement {
  connectedCallback(): void {
    this.textContent = 'spite-player: not implemented yet';
  }
}

if (!customElements.get('spite-player')) {
  customElements.define('spite-player', SpitePlayer);
}
