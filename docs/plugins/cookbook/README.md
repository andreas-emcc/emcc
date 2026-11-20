# The emcc plugin cookbook

Worked recipes for the things most plugins do. Each recipe takes one job from an empty template copy to a tested result, step by step, with the code and the test, and a diagram of who calls whom. The [reference](../reference/README.md) says what every call does; a recipe shows how the calls fit together for one job, and links to the reference for the detail.

Start from the template (`plugins/_template/`, [for-agents.md](../for-agents.md)): every recipe assumes a copy with your plugin id, and most of its code is already in the template.

## The recipes

| Recipe | You get | Diagram |
|---|---|---|
| [A panel](panel.md) | A panel in the shell, built from the shared components, that asks its own server part | [panel](diagrams/panel.drawio.svg) |
| [Settings](settings.md) | Settings with a generated form, applied in both parts without a restart | [settings](diagrams/settings.drawio.svg) |
| [An input link](input-link.md) | A connection to another system that turns what it receives into objects on the map | [classes](diagrams/input-link-classes.drawio.svg), [sequence](diagrams/input-link.drawio.svg) |
| [An output link](output-link.md) | A connection that sends objects out, as a channel other plugins can send to | [output-link](diagrams/output-link.drawio.svg) |
| [A stream](stream.md) | Live video or other binary data from a link to a player in the browser | [stream](diagrams/stream.drawio.svg) |

Read them in this order the first time: each one uses what the one before it showed.

## How a recipe reads

- **You get**: what works at the end.
- **You need**: the manifest entries, the SDK types and the rules the recipe touches. Rule ids (R5, R70 …) are in [rules.md](../reference/rules.md).
- **Steps**: in the order to do them. Code that is yours to write is marked `// yours`.
- **Test it**: the test that shows the recipe works, with the test kit's fakes. Write it first.
- **Pitfalls**: what goes wrong most often, and the rule or check that catches it.

## The diagrams

Each diagram is a `.drawio.svg` file: an SVG picture that also holds the draw.io drawing. A browser or a Markdown viewer shows it as a picture; [draw.io](https://www.drawio.com/) (the desktop app or the VS Code extension, both offline) opens and edits it, and saving keeps both. Edit the file itself; there is no separate source and nothing to export.

Colours: blue is your plugin's code, yellow is ECore, green is the browser's shell, grey is another system.
