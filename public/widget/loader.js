(function () {
    const script = document.currentScript;
    const locationId = script.getAttribute('data-location');

    if (!locationId) {
        console.error('Estio Widget: data-location attribute is required');
        return;
    }

    // Determine base URL (production or local)
    const baseUrl = script.src.includes('localhost')
        ? 'http://localhost:3000'
        : script.src.replace('/widget/loader.js', '');

    const iframe = document.createElement('iframe');
    iframe.style.border = 'none';
    iframe.style.width = '100%';
    iframe.style.height = '600px'; // Initial height, will be adjusted by content
    iframe.style.overflow = 'auto'; // Allow scrolling if content exceeds initial height

    iframe.src = `${baseUrl}/widget/search?location=${locationId}`;

    const container = document.getElementById('estio-widget');
    if (container) {
        container.appendChild(iframe);
    } else {
        // Fallback if no specific container is found, insert before the script
        // This part is adapted from the original logic to ensure the widget is always displayed
        const wrapper = document.createElement('div');
        wrapper.style.width = '100%';
        wrapper.style.minHeight = '600px';
        wrapper.style.border = 'none';
        wrapper.appendChild(iframe);
        script.parentNode.insertBefore(wrapper, script);
    }

    // Optional: Listen for messages to resize iframe
    window.addEventListener('message', function (e) {
        if (e.origin !== baseUrl) return;
        if (e.data.type === 'resize') {
            iframe.style.height = e.data.height + 'px';
        }
    });
})();
