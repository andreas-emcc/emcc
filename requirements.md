# Overview
This file describes a C2 (a mimic of a military command and control system used to showcase what AI agents can do) web based application. The web application is plugin based and is defined by several key points:
- The core (called ECore) is the main framework for holding it all together. It handles loading and unloading of plugins as well as providing central functions for logging and notifications. It will handle the main thread and make sure that all is kept together
- The main user view will be occupied by a big panel with a map that can be zoomed and panned (Map Pane). Around it there are docked panes (left, right and bottom) that hold panels belonging to plugins. The user can move the panels between the panes, and the arrangement is saved per user. A top bar across the page holds the views and small controls, some of them from plugins. The map handling itself is also a plugin, to be able to handle different types of maps
- The web application should define a clear plugin framework that is used to make handling of plugins the same for each type of plugin
- The implementation phase will be handled by several different agents that will develop their own part. A "manager agent" will keep track of the progress made and a separate test agent will test the combined end result
- Code will be written almost exclusively by agents, I will control and make decisions.

# View
The view (WebApp) will contain the following parts.
- The main part of the C2 application is a view of a map with objects on the map. It is divided into 
	- The main part which is a map and the graphical objects in a layer structure
		- The layer structure should have controls for changing draw order of the layers, similar to photoshop
		- The Map has to be able to use different map projections, including polar projections
		- The user must be able to view and enter coordinates in different coordinate systems. At least MGRS, UTM and latitude/longitude in degrees-minutes-seconds
	- Panels in the panes around the map that can be used for plugins to put action buttons in. Such as buttons for creating symbols, multipoint graphics and so on
	- When creating symbols, the available fields are at first only the standard fields, but a plus button adds the special fields from the data models of the plugins. The plugins announce their fields in a standard way through the SDK
- All users share the same live picture. A change made by one user is shown to all other users
- The controller view is a separate part of the WebUI (the Settings tab in the top bar) which opens a totally new page. There a list holds the basic settings of the WebApp and one entry for each plugin that exposes settings
- The simulation view is a separate part of the WebUI (the Simulation tab in the top bar) with its own map, layers and symbols. Only users with the rights for simulation see it (see Simulator)

# Model
The information in the webapp that can be exchanged between plugins has to follow a common information model (the "common data model") and then have extensions per plugin. Some ideas
- Objects on the map are represented by point(s) according to a coordinate system that can be changed. Internally, every point is referenced in one coordinate system and then converted if the user chooses to view coordinates in other coordinate systems
- Every object carries a security label (according to STANAG 4774) from the first version. Using the labels for fine grained access control (deciding per object what a user may see and do) may come in a later version, but it must be possible to add without redesigning the model
- The server holds the master version of every object
- Concurrent editing: if two users edit the same object, the last edit overwrites the earlier one (for now). A locking mechanism may be added later, so the model should be prepared for it
- Plugin extensions are kept intact. A plugin that does not understand another plugin's extension fields passes them along untouched (blind forwarding), so no information is lost between import and export
- History will be required in a later phase: both for auditing (who changed what and when) and for playing back events along a timeline (timeline scrubbing). The model should be prepared for it from the start

# Architecture
The project's main objective is to create a web based Command and Control (C2) application. The technology and framework is not set in stone, but have some requirements
- The server part has to be able to run on both Windows and Linux
- The client part should be able to run in a web browser
- The webapp has to be protected by an IAM such as Keycloak or something similar. A real IAM is used from the first version (not a mockup)
	- The IAM assigns rights to groups and a user can belong to several groups. The groups can then be used to decide what the user can see and do in the WebApp
	- A no-login mode stays available for portable use, demonstrations and tests (owner, 2026-10-10; ADR-0022)
- All writes to persistent storage have to go through a "persistence manager". In that way the storage can easily be changed between different kinds of databases, local file storage and so on
- The solution has to be able to be multi threaded, a lot of stuff will go on in parallel
	- Since we are using multi threading we have to make sure we don't get any deadlocks or race conditions
	- Plugins do not create threads themselves. They request thread-like mechanisms (for example workers, listeners and timers) from ECore, which runs them, keeps them separated and synchronizes them
	- Plugins communicate with each other and with ECore through messages, not by sharing data directly
	- One thread that hangs or deadlocks must not hang the entire application. ECore must detect it and report it
- Since we allow plugins to run work in parallel and communicate in a lot of ways we need advanced monitoring to be able to make sure everything is working
- Plugins run in the same process as ECore. The plugin framework should be prepared for letting some plugins run in their own process in the future (for example plugins with time critical communication). Such a separate process is connected through a stub plugin that communicates with it
- Plugins are loaded when the application starts. Loading or unloading plugins while the application is running is not required
- Plugins are trusted (they are developed within this project, or by third parties against the SDK and installed by the admin), so ECore does not need to protect itself from harmful plugins
Basic requirements
- The application have to be able to be self hosted
- The application has to work in a disconnected environment (no internet access). Internet access is available during development and demonstrations only. For example OpenStreetMap may be used in development and demonstrations, while WMS map servers are used in disconnected environments
- WMS map servers supporting exotic projections (for example polar) are deployed by a separate project and are regarded as existing external systems
- One server instance per server. If more capacity is needed, more servers are added
- The number of users will eventually be big, so even if we start small, it needs to have the possibility to grow
- Able to handle at least 100 000 objects on the map (aggregation of objects allowed when zooming out)
- The full 100 000 objects require client workstations with a graphics card (hardware-accelerated WebGL). Clients without one, for example virtual desktops, show at most about 10 000 objects until aggregation is available
- 2D from the start. 3D can be implemented by separate modules in the future
- From the beginning work with local git, later use a gitlab instance

# Standards to implement
Eventually the following standards need to be implemented. They are of different kinds and are handled by different parts of the system:
- Formats for exchanging objects with other systems (handled by ingoing/outgoing plugins)
	- NVG
	- KML
	- Cursor On Target (CoT)
	- Later, for example as outputs of the simulator: ADatP-36, AIS, ADS-B
- Background maps (handled by map plugins)
	- WMS (and WMTS)
- Symbology (handled by a symbology utility plugin)
	- APP-6 (B, D and E). APP-6 C is not needed for now
- Security labels (handled by ECore and the common data model, since they apply to everything)
	- STANAG 4774 for labeling and 4778 for binding labels to the information. In the first version the binding (4778) may be a mockup, as long as the real implementation can be added in a later sprint without redesign

# External systems
TAK systems (using CoT), NVG systems and WMS map servers will be set up by separate projects. For this project they are regarded as existing external systems that we connect to.

# Milestones
- Internal demo (to check that the "feeling" is right): a web page without login that shows an OpenStreetMap map where the user can draw symbols. No external systems
- First demo:
	- Login with Keycloak (or similar)
	- An OpenStreetMap background map and one map in a polar projection
	- Drawing APP-6 symbols
	- Two browsers showing the same live picture (a change in one is shown in the other)
	- CoT data received from a TAK system shown on the map
- Beautify (M2): the workspace and its look: docked panes with movable panels, saved setups, selection and object actions, plain shapes, three looks
- Simulator (M3):
	- Plugins can receive and send data in any of the ways described under Plugins. CoT can be both received and sent
	- The simulator in its own view, with its tracks sent out as CoT to a TAK system and coming back into the normal view
	- Fields from the data models of the plugins can be added when creating symbols
- Later phases (examples): history with audit and timeline playback, access control based on security labels, real STANAG 4778 binding, plugins in separate processes, 3D

# Plugins
A plugin is one package that can contain two optional parts:
- A server part that runs on the server. Needed for example to listen to external systems, which a web browser cannot do
- A web part that runs in the browser. Needed for example for panels and buttons in the panes around the map, settings and drawing on the map
A plugin can have one or both parts. The parts of a plugin are loaded, unloaded and versioned together.

Several types of plugins
- Map plugins: Can be used in the map view to display background maps. For example OpenStreet Map and OGC WMS/WMTS
- Utility plugins: Do not put or interact with objects on the map on itself. They provide services internally for other plugins. For example a Symbology service, location service and so on
- General plugins: Can place objects on the map
The plugins can have several type properties
- Ingoing type property: A plugin that consumes data and shows it on the map
	- May communicate via push or pull mechanisms
- Outgoing type property: A plugin that can produce data that leaves the webapp
	- May communicate via push or pull mechanisms
- Nothing in the framework may hinder the ways a plugin receives or sends data
	- In: a UDP listener, a multicast listener, a TCP server that a data provider connects to and pushes data through, or a TCP client that connects to a server and gets the data
	- Out: a UDP sender, a multicast sender, a TCP server that sends to the systems that connect to it, or a TCP client that connects to a remote server and pushes the data
	- The transport is always up to the plugin. ECore does not make helpers or wrappers for the transports, since wrapping them all would mean constant redesigns that affect all plugins. ECore gives the plugins long-lived connections and monitors them
	- Other parts of emc2 send and receive data through these plugins in a standard way, through layers or directly, with updates at least once a second

Since plugins may be of so many different kinds, the framework in the WebApp has to be able to give plugins the possibility to use several advanced mechanisms, such as:
- The ability to request listener threads (from ECore) to listen for incoming data
- The ability to request threads (from ECore) for connecting to external sources
- The ability to extend the common datamodel with fields and properties specific for the plugin

# Simulator
A simulator lets users run scenarios whose tracks are sent out through the plugins. It works in its own view, the simulation view, so that it does not clutter the normal view, and it has its own user rights: to see it, to edit it and to run it.
- One simulation is shared by everyone who may see it, and it is kept over a restart of the server
- Symbols are placed on the map of the simulation view. The simulation view reuses the plugins of the normal view (maps, layers, symbols and so on) without copied code
- The simulator handles at least 1 000 tracks updated once per second. Outputs that are slow by nature may send less often
- The simulator sends the "ground truth": everything in the simulation is sent. Later, sensors (fixed and moving) will give a "detected objects" view instead of the complete picture
- The outputs are taken from the plugins that offer them: CoT now, later others such as ADatP-36, AIS and ADS-B, also from 3rd party plugins. The simulator searches the plugins for their output types and data models
- Routes can be created and edited
	- Each route point has a speed and an altitude. Each is either instant (set when the point is reached) or ramp (it changes from the previous point and reaches the value at the point; on the first point a ramp acts as instant)
	- Instead of a speed, a time can be given, from the previous point or from the start of the route. The speed is calculated from it and rounded. Both the speed and the time are shown in the route editor
	- When a route with objects is edited, the user chooses whether the objects move with the route or are disconnected. Disconnected objects stop (speed 0) and keep their altitude
- Objects are attached to a route one by one or as a group
	- Convoy: the objects follow each other at a distance set in meters
	- Formation: the objects keep their relative positions while the centre of the formation follows the route. In corners objects far from the centre move unnaturally, which is ok
- Each route, and all routes together, can be started, paused and reset
- Events can be attached to each route point, for the objects of the route. More kinds will come; at first two:
	- Change a data field of the object(s), for example a status
	- Hide the object: it is no longer sent, or a delete is sent if the output supports it
- At the end of a route the tracks either stop, or the route starts again from the beginning

# Development methodology
The development will take place with agents in different "levels":
- Architectural consultant agent (ACA): Will read the high level design (such as this document and similar instructions) and help the owner create descriptions for the rest of the agents. Will also help make architectural choices, such as which programming language to use and which frameworks to use
- Core-develop agent (CDA): Will develop code for the Core (called ECore) part of the web application. That is the main control threads, the runtime that hosts the plugins and so on
- Plugin design agent (PDA): Will develop the plugin framework, i.e. the rules and interfaces every plugin follows. Make sure there is a clear interface for plugins to interact with each other, the map and ECore. Owns the common data model.
	- Actual plugin development will then be performed in specialized agents handling just one plugin per agent
- Plugin Coding Agents (PCA): Multiple agents that will develop/code the actual plugins that gives the web application its functions
- Integration Test Agent (ITA): Will test the combined end result of all agents
- Management and Controller Agent (MCA): Will manage the results from the different agents and how to handle Change Control Board and Version Control (Suggest git-operations)

Work order
- The common data model and the plugin interfaces are agreed and frozen before CDA and the PCAs start building against them. Changes after that go through change control (MCA)

In a much later phase, a recipe (a CLAUDE.md or similar) will be written that lets others build agents for this project in the same way

# Agent description
- Architectural consultant agent (ACA): The architectural Agent will be the one in charge of making sure the end result is a well programmed product following common design rules and that the solution is maintainable. It will ask questions to clarify everything and create it's own MD-file(s) for details as well as propose suggestions on how to change and develop the user made MD-files that describes the project (this file amongst others). This file is deliberately kept clean of technical details. The idea is to have ACA ask questions and provide suggestions for target architecture and frameworks to use and then create the detailed MD-file(s) to dig deep into technology
	- Makes the first draft of the common data model, which is then handed over to PDA
- Core-develop agent (CDA): Handles developing the core framework for running the application. That is:
	- Control thread for running the application
	- Log handling: Providing a log interface for the other plugins
	- Plugin handling: The runtime that hosts plugins. Loading and unloading plugins. Running the workers, listeners and other thread-like mechanisms that plugins request. Surveillance of plugins memory usage, thread count and so on
	- Providing a framework for the web view divided into several parts:
		- The user view part where the map and map objects live
		- The settings view: a list with the settings for the Core and one entry for each plugin that exposes settings, where plugins can put/draw their own setting webparts
		- A monitor view where main parameters of the web application can be monitored as well as 
		- Prepared to handle future additional parts
- Plugin design agent (PDA): Will develop the plugin framework. Make sure there is a clear interface for plugins to interact with the map and ECore. For example:
	- Own and maintain the common data model (after ACA's first draft), including how plugins extend it
	- Make the interface that the plugins can use to publish their settings in the settings part of ECore
	- Make the interface for where the plugins can place their panels in the panes around the map, and small controls in the top bar
	- Make the interface for how plugins request workers, listeners and other thread-like mechanisms from ECore, and how plugins send messages to each other
	- Make the interface for a map plugin to use. Will define the means for the Map Plugins to receive requests for map tiles and how to respond with the images containing the map tiles
	- Make the interface for a general plugin to use to put graphical objects on the map. Both images (vector and bitmap). But also draw shapes and forms (based on geo coordinate systems) based of vector points (For example lines, circles, areas and so on)
	- Make a design pattern (an MD-file fed to Plugin Developer Agents) that will make plugins designed in a similar ways no matter what agent has developed the plugin
- Boundary between CDA and PDA: CDA owns the runtime that hosts and runs the plugins. PDA owns the rules and interfaces every plugin follows. CDA builds the runtime against PDA's interfaces
- Plugin Coding Agents (PCA): Multiple agents that will develop/code the actual plugins that gives the web application its functions
	- Will be several agents that provide the functionality to put objects on the map
- Integration Test Agent (ITA): Tests the combined result of all agents. Builds and runs the whole application together with the plugins, runs tests across parts (for example: an object received from an external system shows up correctly for all users) and reports problems back to MCA
- Management and Controller Agent (MCA): Will manage the results from the different agents and how to handle Change Control Board and Version Control (Suggest git-operations)
