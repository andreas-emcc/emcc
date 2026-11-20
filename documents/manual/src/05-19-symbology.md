# Symbology

Settings for the plugin that draws the military symbols.

| Setting | What it does | Default |
|---|---|---|
| Symbol images in the cache (in the folded group **Advanced**) | How many symbol images the cache keeps. When it is full the least recently used are dropped first. A whole number, at least 1 | 2 000 |
| Tactical graphic timeout (also in **Advanced**) | How long a tactical graphic may take to draw, in seconds. A slower graphic is not drawn: the map shows a marker instead. A whole number from 1 to 30 | 5 |
| Sensor report shape | The shape of the mark that every sensor report, for example a GMTI detection, is drawn as: dot, cross, ring, diamond or square | dot |
| Sensor report colour | The colour of the mark: yellow, orange, red, magenta, cyan, green, blue, white or black. The mark has a black outline, and a black mark a white one, so that it shows on a light and a dark map | orange |
| Sensor report size | The size of the mark, in pixels, from 4 to 32. A whole number | 10 |

A change of the three settings for sensor reports draws the marks again at once, in every browser. The mark is the same for every sensor report: no look, no user setting and no label changes it.

A larger cache uses more memory in each browser and draws a map with many different symbols faster. The default is right for most installations.
