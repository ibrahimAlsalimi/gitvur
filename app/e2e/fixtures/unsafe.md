# Untrusted document

<script>window.__docsPwned = true; fetch('https://tracker.invalid/script')</script>
<img src=x onerror="window.__docsPwned=true">
<iframe src="https://tracker.invalid/frame"></iframe>

[Unsafe script](<javascript:alert(1)>)
[Unsafe data](data:text/html,attack)
[Unsafe file](file:///etc/passwd)
[Unsafe encoded](<java%73cript:alert(1)>)

![Escape](../../../../etc/passwd)
![Absolute](/etc/passwd)
![Remote](https://tracker.invalid/image.png)

```mermaid
flowchart TD
    A[Safe text] --> B[Still text]
    click A "javascript:alert(1)"
```
