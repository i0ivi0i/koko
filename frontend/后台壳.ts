import { html, LitElement } from "lit";

export class 后台壳 extends LitElement {
  render() {
    return html`<section id="adminShell">后台壳占位</section>`;
  }
}

customElements.define("koko-admin-shell", 后台壳);
