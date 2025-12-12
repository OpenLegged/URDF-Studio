import * as React from 'react';
export type StatsProps = {
    showPanel?: number;
    className?: string;
    parent?: React.RefObject<HTMLElement>;
};
export declare function Stats({ showPanel, className, parent }: StatsProps): null;
