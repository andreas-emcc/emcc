# Compute threads

Most of what a plugin does is short: it answers a message and is done. Some work is not short. A simulated camera that draws 25 pictures a second keeps one processor core busy for as long as it runs. Such a plugin declares **compute threads**. emcc creates them, limits them and shows them, so that one plugin cannot take all the processors from the others. This chapter is about the two limits that you set, and how to read the Monitor.

**Draft.** Written from ADR-0064. Checked against a release built from commit c60fea19 and run without administrator rights. Text with CHECK in square brackets waits for a later check.

## What a compute thread is

- A plugin says in its manifest how many compute threads it needs at most, and why. A plugin that does not say gets none.
- emcc, not the plugin, creates the thread, starts the work on it, stops it, and starts it again after a failure if the plugin asks for that.
- The work on it is plugin code that does calculation only. It opens no connections, makes no calls to other servers and changes no objects; the plugin's other parts do that.
- A compute thread is not the same as the workers that run a plugin's ordinary work, and it is not the pool for short jobs, such as a viewshed. Those are not counted here.

**One plugin of this release uses compute threads: FMV.** It declares **8**, one for each simulated camera that sends video (see [A simulated camera](04-06-camera.md)), and it draws the pictures on them. The Monitor shows 0 of the total limit until a camera sends. A plugin that you add may declare them too.

## The two limits

| Limit | What it does | Default |
|---|---|---|
| **Per plugin** | Lowers a plugin's compute threads below what it declares, or switches them off with 0. Its tasks then do not start, and the plugin's status says why | The plugin's declaration |
| **In total** | The most compute tasks that run at the same time, for all plugins together | The computer's processors minus one, and at least one |

The total limit counts the tasks that **run**. A plugin's declared threads that are not running take nothing from it. A task that would start above the limit is **refused**, with the reason, and the refusal is counted. Nothing else stops.

**Where you set them:**

- **Per plugin:** in [Settings](05-00-settings.md), in the plugin's own entry. A plugin that declares compute threads has an entry even if it has no other settings. At the top of it is a group **Compute threads** with the field **Tasks at once**: a number from 0 to what the plugin declares, where 0 switches them off. The help under the field says what the plugin declares and why. A number that you save takes effect at once, and lowering it stops the plugin's newest tasks. It is kept in `data/ecore-config.json`, with the other settings of the Settings workspace.
- **In total:** `emc2.compute.max-threads` in `settings/emcc.properties`, from 1 to 1024. Left empty, it is the computer's processors minus one, and at least one. It is read when the server starts.

### Sizing them

A compute thread that runs all the time holds about one processor core. A camera that draws a 1280 × 720 picture 25 times a second needs about one core (on the project’s test computer a picture took about 40 ms to draw, as the Monitor’s *render time* shows). Leave processors for the server's own work, the browsers' live pictures and the conversions of video. A computer with few cores runs few cameras.

| Computer | Total limit to start with |
|---|---|
| 4 processors | 3, the default |
| 8 processors | 7, the default. Lower it if the computer also does other work |

## The Monitor

The [Monitor workspace](06-00-monitor.md) shows the threads in two places.

- In the **Core** tiles, the tile **Compute threads** says how many run against the total limit, for example *1 of 11* while one camera sends.
- In the **Plugins** list, a plugin that declares compute threads has a line *Compute threads: 2 running of 2 allowed (declares 2: its reason)*, and, when starts were refused, *refused starts:* with the counts and the reasons. Under it is a table `<plugin>: compute tasks`, with a row for each task:

| Column | Meaning |
|---|---|
| Task, State | The task's name, and whether it runs, restarts (with the time and the reason) or has failed (with the reason) |
| For | How long it has been in this state |
| Restarts | How many times it was started again |
| Busy | The part of the time that the task does not wait for work |
| CPU time | The processor time the task has used |
| Counters and details | What the plugin reports about it, for example the pictures drawn, and the ones that were late or dropped |
| Inbox | How many items wait for it, and how many were lost or replaced |

A task that does not stop within a grace time after it was told to is marked **hung**. Its plugin then shows **DEGRADED**, and the thread may stay until the server is restarted.

## When something is wrong

| What you see | What to do |
|---|---|
| A plugin's tasks do not start, and the Monitor counts *refused starts* | The per-plugin number may be 0: look at **Tasks at once** in the plugin's Settings entry, and raise it. Otherwise the total limit is reached |
| A task is refused, and the Monitor counts refusals | The total limit is reached. Stop a task that is not needed, raise the limit if the computer has the processors for it, or lower another plugin's limit |
| A task's busy share is near 100 % and everything else is slow | Too many tasks for the computer. Lower the limits |
| A task is marked hung and the plugin is DEGRADED | Restart the server. Report the plugin's name and the log |
