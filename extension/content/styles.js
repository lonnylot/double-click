'use strict';

globalThis.DoubleClickStyles = `
:host { all: initial; }
.dc-root, .dc-root * { box-sizing: border-box; }
.dc-root {
  all: initial;
  color-scheme: dark;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  color: #f4efe6;
  font-size: 14px;
  line-height: 1.45;
  letter-spacing: 0;
}
.dc-trigger, .dc-panel { position: fixed; pointer-events: auto; z-index: 1; }
.dc-trigger {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 30px;
  padding: 0 11px 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(227, 155, 74, 0.72);
  background: #16130f;
  color: #f4efe6;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  font: 600 12px/1 "Avenir Next", "Segoe UI", sans-serif;
  letter-spacing: 0.02em;
  cursor: pointer;
}
.dc-trigger:hover { background: #221c16; }
.dc-trigger:focus-visible, .dc-icon:focus-visible, .dc-send:focus-visible, .dc-select:focus-visible, .dc-input:focus-visible {
  outline: 2px solid #f0c48a;
  outline-offset: 2px;
}
.dc-mark { position: relative; width: 14px; height: 14px; display: inline-block; flex: none; }
.dc-mark::before, .dc-mark::after {
  content: "";
  position: absolute;
  top: 3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e39b4a;
}
.dc-mark::before { left: 0; }
.dc-mark::after { left: 5px; }
.dc-panel {
  width: min(400px, calc(100vw - 16px));
  max-height: min(540px, calc(100vh - 16px));
  display: flex;
  flex-direction: column;
  background: #14110e;
  color: #f4efe6;
  border: 1px solid rgba(243, 230, 208, 0.14);
  border-radius: 16px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.dc-panel.dc-in { animation: dc-in 140ms ease-out; }
@keyframes dc-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .dc-panel.dc-in { animation: none; } }
.dc-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 8px 12px;
  border-bottom: 1px solid rgba(243, 230, 208, 0.1);
}
.dc-brand { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 13px; letter-spacing: 0.01em; }
.dc-select {
  margin-left: auto;
  max-width: 150px;
  appearance: none;
  background: #221c16 url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6'><path d='M1 1l4 4 4-4' stroke='%23b7ab9c' fill='none'/></svg>") right 8px center no-repeat;
  color: #f4efe6;
  border: 1px solid rgba(243, 230, 208, 0.16);
  border-radius: 999px;
  padding: 4px 22px 4px 10px;
  font: 500 12px/1.2 "Avenir Next", "Segoe UI", sans-serif;
}
.dc-icon {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #b7ab9c;
  cursor: pointer;
  font: 16px/1 "Avenir Next", "Segoe UI", sans-serif;
}
.dc-icon:hover { background: #221c16; color: #f4efe6; }
.dc-passage {
  margin: 10px 12px 0;
  padding: 8px 10px;
  border-left: 2px solid #e39b4a;
  color: #d9cbb8;
  font-family: "Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif;
  font-size: 13.5px;
  line-height: 1.45;
  max-height: 7.2em;
  overflow: auto;
}
.dc-thread {
  flex: 1;
  overflow: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 72px;
}
.dc-msg { max-width: 100%; }
.dc-msg p, .dc-msg ul, .dc-msg ol, .dc-msg pre, .dc-msg blockquote { margin: 0 0 8px; }
.dc-msg p:last-child, .dc-msg ul:last-child, .dc-msg ol:last-child { margin-bottom: 0; }
.dc-user p {
  margin: 0;
  padding: 8px 10px;
  background: #2a231c;
  border-radius: 12px 12px 4px 12px;
  white-space: pre-wrap;
}
.dc-assistant { font-size: 14px; }
.dc-assistant .dc-md code {
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 12.5px;
  background: #0e0c0a;
  padding: 0 4px;
  border-radius: 4px;
}
.dc-assistant .dc-md pre {
  background: #0e0c0a;
  padding: 8px 10px;
  border-radius: 8px;
  overflow: auto;
}
.dc-assistant .dc-md pre code { padding: 0; background: transparent; }
.dc-assistant .dc-md a { color: #f0c48a; }
.dc-assistant .dc-md blockquote { margin-left: 0; padding-left: 8px; border-left: 2px solid rgba(227, 155, 74, 0.5); color: #d9cbb8; }
.dc-error {
  background: rgba(224, 122, 104, 0.12);
  color: #f0c2b8;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 12.5px;
  white-space: pre-wrap;
}
.dc-error code {
  display: block;
  margin-top: 6px;
  font-family: ui-monospace, Menlo, Consolas, monospace;
  color: #f4efe6;
}
.dc-caveat {
  margin: 8px 12px 0;
  color: #d9cbb8;
  font-size: 12px;
  line-height: 1.4;
}
.dc-caveat label { display: flex; gap: 8px; align-items: flex-start; margin-top: 6px; cursor: pointer; }
.dc-composer {
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 10px 12px 8px;
  border-top: 1px solid rgba(243, 230, 208, 0.1);
}
.dc-input {
  flex: 1;
  resize: none;
  min-height: 38px;
  max-height: 120px;
  border: 1px solid rgba(243, 230, 208, 0.16);
  background: #1c1814;
  color: #f4efe6;
  border-radius: 12px;
  padding: 8px 10px;
  font: 14px/1.4 "Avenir Next", "Segoe UI", sans-serif;
}
.dc-input::placeholder { color: #7c7368; }
.dc-send, .dc-stop {
  border: 0;
  border-radius: 999px;
  height: 34px;
  padding: 0 12px;
  cursor: pointer;
  font: 600 12px/1 "Avenir Next", "Segoe UI", sans-serif;
}
.dc-send { background: #e39b4a; color: #1a1208; }
.dc-send:disabled { opacity: 0.45; cursor: default; }
.dc-stop { background: #3a2a28; color: #f0c2b8; }
.dc-foot { margin: 0; padding: 0 12px 10px; color: #7c7368; font-size: 11px; }
.dc-toast {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  background: #16130f;
  color: #f4efe6;
  border: 1px solid rgba(227, 155, 74, 0.5);
  border-radius: 999px;
  padding: 8px 12px;
  font: 500 12px/1 "Avenir Next", "Segoe UI", sans-serif;
  pointer-events: none;
}
.dc-caret { display: inline-block; width: 7px; height: 1em; margin-left: 2px; background: #e39b4a; vertical-align: text-bottom; animation: dc-blink 1s steps(1) infinite; }
@keyframes dc-blink { 50% { opacity: 0; } }
`;
