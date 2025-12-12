import * as React from 'react';
export type HudProps = {
    children: React.ReactNode;
    renderPriority?: number;
};
export declare function Hud({ children, renderPriority }: HudProps): React.JSX.Element;
