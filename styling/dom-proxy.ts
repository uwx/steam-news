const rss = document.getElementById('rss');

interface ProxiedElement<H extends HTMLElement = HTMLElement, TypedChildren extends { [childElement: string]: ProxiedElement } = {}> {
    text: string;
    attr: Record<string, string>;
    el: H;
    children: TypedChildren & {
        [childElement: string]: ProxiedElement | undefined;
    };
}

const handler = {

} satisfies ProxyHandler<HTMLElement>;

new Proxy<HTMLElement>(rss, )