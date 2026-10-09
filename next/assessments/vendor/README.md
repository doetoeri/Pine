# Attachment reader dependencies

- PDF.js / pdfjs-dist 6.4.299, Mozilla, Apache-2.0. Legacy minified display and worker builds. CMaps, standard fonts and image decoders are local and fetched only when the document needs them. The optional QuickJS evaluator is omitted; the reader disables evaluation and scripting.
- StPageFlip / page-flip 2.0.7, MIT. Source: https://github.com/Nodlik/StPageFlip

StPageFlip has two small local changes in Render: `start()` exposes `pcWake()` and runs frames only while an animation is active, and `startAnimation()` resets its timestamp before waking. Both the animation start and render use `performance.now()` so an input arriving within a frame cannot produce a negative animation frame index. The reader wakes the renderer after user input, page changes and resize, and stops it on disposal. This avoids the upstream permanent idle rendering loop. `UI.destroy()` also always removes its resize listener, including when pointer handling is supplied by the reader. Its paper geometry is unchanged.
