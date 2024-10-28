const rss = document.getElementById('rss');

interface ProxiedElement {
    text: string;
    attr: Record<string, string>;
    el: H;
    [childElement: string]: ProxiedElement | undefined;
}

new Proxy<HTMLElement>()