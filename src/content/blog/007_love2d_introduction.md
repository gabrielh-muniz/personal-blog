---
title: "LOVE2D Introduction"
description: "LÖVE (also known as Love2D) is a free, open-source 2D game development framework that uses the Lua programming language. It's designed to be lightweight and fast, providing a powerful yet simple API for developers to create games from scratch using code."
date: 2026-03-11
tags: ["Lua", "love2d", "game"]
image: "/images/posts/love2d_tutorial/intro/love2d_tutorial.png"
---

Love2d (commonly called LÖVE2D) is a minimalist 2D game framework built around the Lua programming language and a carefully constrained execution model. Rather than imposing a full game engine architecture, Love2d exposes a small set of event-driven callbacks and subsystem modules that allow developers to construct their own runtime behavior. This article examines Love2d from a systems perspective: how its architecture maps to classical game loop models, how Lua's runtime semantics shape its design, and how its modular subsystems interact to produce deterministic interactive programs. Understanding these internal mechanisms reveals not only how Love2d works, but also why its architecture remains both simple and expressive for game prototyping and systems experimentation.

# Why Love2d exists and why it matters

In the landscape of game development tools, frameworks and engines occupy different positions along the abstraction spectrum. **Game Engines** such as Unity or Unreal Engine provide a large integrated runtime containing scene graphs, asset pipelines, physics engines, editors, scripting layers, etc. By contrast **Game Frameworks** provide a much thinner abstraction layer: they expose low-level primitives for rendering, input, timing, and resource management, leaving most architectural decisions to the developer. Love2d belongs firmly in the latter category.

Originally created by Uliko and later maintained by a broader open-source community, Love2d was designed around three key principles:

1. Minimalism
2. Portability
3. Lua-driven scripting

The framework exposes a small collection of modules (graphics, audio, input, filesystem, etc.) while relying on Lua as the primary control language. Rather than providing a predefined object model or scene structure, Love2d simply executes a lua program and repeatedly calls a few well-defined callback functions such as:

```lua
love.update(dt)
love.draw()
```

From a systems design perspective, this approach raises deeper question:

> What computational model allows a simple set o callbacks to drive an entire interactive system?

The answer lies in the classical game loop architecture, a deterministic runtime cycle that integrates **state updates**, **event processing**, and **rendering** into a continuos simulation. Love2d implements this loop internally while exposing only the high-level control points to the user program.

In this article we explore Love not merely as a tool for drawing sprites, but as a structured runtime environment for interactive simulations.

# The ideas behind the Framework

## Interactive programs as state machines

To understand Love2d design, we must situate it within several foundational model from computer science and software architecture.

At its core, a video game can be modeled as a **state transition system**.

Formally:

```math
S(t+\Delta t) = F(S(t), I(t))
```

Where:

- $S(t)$ represents the system state at time $t$.
- $I(t)$ represents user input and external events.
- $F$ is the transition function that produces the next state.

Rendering then becomes a **projection function**:

```math
Frame=R(S(t))
```

Where $R$ maps internal state to visual output.

Love2d programming model directly reflects this mathematical abstraction:

- `love.update(dt)` implements $F$.
- `love.draw()` implements $R$.

Thus, a Love2d application is essentially a continuous state machine simulation driven by the passage of time.

## The _Game Loop_ as a deterministic runtime

Nearly every real-time game relies on some variation of the **game loop**, an execution cycle that repeats indefinitely until forced (or not) termination.

Conceptually:

```sh
while running:
  process_input()
  update_simulation()
  render_frame()
```

Love internalizes this structure and calls developer-defined callback at the appropriate points. The image below shows us an execution flow of a common Love2d application. The operating system delivers input events, which are processed bu the Love2d runtime loop. The loop polls input, updates the simulation state, renders a frame, and finally presents the result to the display.

![execution_flow](/images/posts/love2d_tutorial/intro/execution_flow.png)

Importantly, the loop itself is not written by the developer. It's implemented inside the Love2d runtime (in C/C++) and drives the Lua program through callbacks.

This separation mirrors patterns found in many system:

- Operating systems calling interrupt handlers
- Web frameworks invoking request handlers
- GUI frameworks dispatching event callbacks

Love2d therefore acts as an event-driven runtime environment rather than a traditional library.

## Lua as an embedded control language

The choice of Lua is not accidental. Lua is widely used as an embedded scripting language because of several properties:

- Extremely small runtime
- Fast interpreter
- Simple C API
- Dynamic typing
- First-class functions
- Lightweight coroutines
- Better readability

From a system standpoint, Lua allows Love2d to separate:

- performance-critical subsystem (implemented in C/C++)
- game logic (implemented in Lua)

Because Lua is dynamically typed and interpreted, iteration speed for developers is extremely high: changes can be made quickly without recompilation.

# How Love2d actually works under the hood

To understand this framework deeply, we must examine its internal architecture and execution flow. Although the developer only write Lua code, the runtime consists of several interacting components.

## Core runtime layers

1. Hardware / OS: the platform-specific layer (Windows, macOS, Linux, Android, etc.) handling OpenGL/DirectX/Vulkan rendering, audio device management, input device, etc.

2. C++ Core framework (Love2d Engine): provides the core engine, managing hardware interactions, memory, and implementing core functions. This layer includes module management (graphics, audio, filesystem, physics).

3. Lua interpreter/biding layer (LuaJIT): acts as the bridge between Lua code and the C++ engine. It exposes all C++ function to the Lua script environment.

4. Game logic (Lua script): the developer-written code (`main.lua`) that defines game behavior, responding to callbacks like `love.load`, `love.update`, and `love.draw`.

Essentially, Love2d acts as a **biding layer** between Lua and these underlying systems.

## Runtime steps

Basically, when a program starts, the following steps occur:

1. Runtime bootstraps Lua
2. Loads the game directory
3. Execute `main.lua`
4. Registers callback functions
5. Enters the main loop

Conceptually:

```python
load_lua_runtime()
load_game_files()
execute_main_lua()

while application_running:
  dt = compute_delta_time()
  call_lua("love.update", dt)
  call_lua("love.draw")
  swap_buffers()
```

The callbacks are dynamically resolved at runtime. If a callback does not exist, Love2d simply skips it.

## Time and simulation

A crucial element in game architecture is **time management**. This article will not cover all the fundamentals and concepts around a delta time. If you want a article about this topic, feel free the leave comment down in the comment section.

Love2d provides a delta-time value:

```lua
dt = time_since_last_frame
```

This enables frame-independent simulation:

```lua
position = position + velocity * dt
```

Without this technique, the simulation would depend on frame rate and produce inconsistent behavior across hardware.

# From theory to a simple code

Let us observe how the theoretical models discussed earlier appear in the real Love2d code. A minimal program would look like this:

```lua
function love.update(dt)
end

function love.draw()
  love.graphics.print("Hello Love2d", 400, 300)
end
```

Despite the simplicity, this program participates in the full runtime loop described earlier. Internally the system behaves like:

```sh
loop:
  update(dt)
  draw()
```

Suppose we want to move a circle across the screen.

```lua
x = 0
speed = 100

function love.update(dt)
  x = x + speed * dt
end

function love.draw()
  love.graphics.circle("fill", x, 300, 20)
end
```

This snippet explicitly implements a basic state machine model introduced earlier.

- State:

```math
S=x
```

- Transition function:

```math
x(t+\Delta t)=x(t)+v\Delta t
```

- Rendering function:

```math
R(S)\to circle(x)
```

The entire game is therefore a continuous numerical integration of system state.

# Strengths, limits and trade-offs

Love2d's design embodies some architectural trade-offs.

## Strengths

- **Architectural simplicity**: the framework exposes a minimal interface, allowing developers to build their own abstractions. This leads to strong conceptual transparency; The developer always knows exactly what the runtime is doing.
- **High iteration speed**: Lua's interpreted execution enables extremely rapid experimentation. Compare to compiled languages, it has no compilation step and we need a minimal boilerplate. This property is especially valuable during early-stage game design.
- **Portability**: because the runtime encapsulates platform-specific concerns through SDL and OpenGL, Love2d programs can run across different operating systems with minimal modification.

## Trade-offs

- **Lack of built-in architecture**: unlike large engines, this one does not provide entity component systems, physics engines, scene graphs or asset pipelines. Developers mus construct these system themselves. While this increases flexibility, it also increase engineering responsibility.
- **Performance constraints**: Lua is fast for scripting but slower than native code for heavy computation. Performance-critical tasks (such as physics simulation or pathfinding) may require additional setup like LuaJIT, C extensions or optimized algorithms.
- **Single-threaded execution**: most Love2d programs run on a single main thread. Although Lua supports coroutines and Love2d supports threads through channels, concurrency remains relatively manual.

# Things that may surprise you

> Love2d is a game engine

It is not a full engine. It's closer to a runtime platform for interactive simulations. The developer constructs the engine architecture on top of it.

> `love.draw()` updates game state

A common beginner mistake is mutating game state inside the draw function. But, rendering should ideally pure (`draw(S)`). State evolution should happen only in `love.update`.

> `dt` should be part of your code

If a developer ignores the `dt` parameter, the simulation becomes **frame dependent**. Consider a simple example where the position of an object along the $x$-axis is updated by a constant increment each frame:

```math
x=x+5
```

In this formulation, the displacement is tied directly to the number of frames rendered, rather than to the passage of time. As a consequence, the object will move faster on systems capable of producing more frames per second. High-end hardware therefore alters the behavior of the simulation, which violates an important principle of interactive system design: the evolution of state should depend on time, not on frame count.

The correct implementation multiples the displacement by the _delta time_:

```math
x=x+5*\Delta t
```

To illustrate why this works, consider two systems running the same program. Suppose the faster machine executes the game loop with a $\Delta t$ of `0.01`, while a slower machine produces frames with a $\Delta t$ of `0.02`. The slower system therefore advances the simulation in larger temporal increments, but does so fewer times per second. Conversely, the faster system performs more update iterations, but each iteration advances the state by a proportionally smaller amount.

Because the state transition is scaled by $\Delta t$, the cumulative displacement over one second remains approximately equal on both machines. The simulation therefore evolves at the same physical speed regardless of frame rate, ensuring temporal consistency across different hardware environments.

# Final thoughts and what comes next

Love2d represents a fascinating example of minimalist systems design. By exposing only a handful of callbacks and modular subsystems, it provides just enough structure to support real-time interactive programs while avoiding the complexity of large game engines.

At a deeper level, the framework demonstrates how a simple computational model - the game loop as a deterministic state machine - can serve as the foundation for complex simulations and games. Lua's lightweight runtime further enhances this architecture by separating high-level control logic from performance-critical subsystems implemented in native code.

Understanding these internal mechanisms transforms Love2d from a simple graphics framework int a laboratory for systems experimentation. In the next article of this series, we will begin constructing the architecture of our Asteroids game, translating these conceptual foundations into concrete design decisions about state management, entity representation, and simulation structure.

## References

- Love2d official [documentation](https://love2d.org/wiki/Main_Page)
- Gregory, Jason. _Game Engine Architecture_
- Nystrom, Robert. _Game Programming Patterns_.
- Lua reference [manual](https://www.lua.org/manual/5.5/)
