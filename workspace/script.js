document.addEventListener('DOMContentLoaded', function() {
    const btn = document.createElement('button');
    btn.textContent = 'Click me!';
    btn.style.margin = '20px auto';
    btn.style.backgroundColor = '#4CAF50';
    btn.style.color = 'white';
    btn.style.padding = '10px 20px';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.onclick = function() {
        alert('Hello from RandomCo!');
    };
    document.body.appendChild(btn);
});