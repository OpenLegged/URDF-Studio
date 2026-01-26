import React, { useRef, useState, useEffect } from 'react';
import type { JointControlItemProps } from '../types';

export const JointControlItem: React.FC<JointControlItemProps> = ({
    name,
    joint,
    jointAngles,
    angleUnit,
    activeJoint,
    setActiveJoint,
    handleJointAngleChange,
    handleJointChangeCommit,
    onSelect
}) => {
    const limit = joint.limit || { lower: -Math.PI, upper: Math.PI };
    const value = jointAngles[name] || 0;
    const itemRef = useRef<HTMLDivElement>(null);

    // Auto-scroll into view when active
    useEffect(() => {
        if (activeJoint === name && itemRef.current) {
            itemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [activeJoint, name]);

    // Convert for display
    const displayValue = angleUnit === 'deg' ? value * 180 / Math.PI : value;
    const displayMin = angleUnit === 'deg' ? limit.lower * 180 / Math.PI : limit.lower;
    const displayMax = angleUnit === 'deg' ? limit.upper * 180 / Math.PI : limit.upper;
    const step = angleUnit === 'deg' ? 1 : 0.01;

    // Local state for the input field to allow free-form typing (e.g. deleting everything, typing minus sign)
    const [inputValue, setInputValue] = useState(displayValue.toFixed(2));

    // Update local state when external value changes (e.g. from dragging or unit switch)
    useEffect(() => {
        setInputValue(displayValue.toFixed(2));
    }, [displayValue]);

    const commitChange = (valStr: string) => {
        const val = parseFloat(valStr);
        if (!isNaN(val)) {
            const radVal = angleUnit === 'deg' ? val * Math.PI / 180 : val;
            handleJointChangeCommit(name, radVal);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const s = e.target.value;
        setInputValue(s);

        // Only update the actual joint if it's a valid number
        const val = parseFloat(s);
        if (!isNaN(val)) {
            const radVal = angleUnit === 'deg' ? val * Math.PI / 180 : val;
            handleJointAngleChange(name, radVal);
        }
    };

    return (
        <div
            ref={itemRef}
            onClick={() => {
                setActiveJoint(name);
                onSelect?.('joint', name);
            }}
            className={`space-y-1 p-2 rounded-lg transition-colors cursor-pointer ${
                activeJoint === name
                    ? 'bg-blue-100/50 dark:bg-google-blue/20 border border-blue-300 dark:border-google-blue/50'
                    : 'bg-white/50 dark:bg-google-dark-bg/30 border border-transparent hover:bg-slate-100 dark:hover:bg-google-dark-bg/50'
            }`}
        >
            <div className="flex justify-between text-xs items-center">
                <span
                    className={`truncate cursor-pointer font-medium ${activeJoint === name ? 'text-blue-600 dark:text-google-blue' : 'text-slate-700 dark:text-slate-200'}`}
                    title={name}
                    onClick={() => {
                        setActiveJoint(name);
                        onSelect?.('joint', name);
                    }}
                >
                    {name}
                </span>
                <div className="flex items-center gap-1">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onBlur={() => commitChange(inputValue)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                commitChange(inputValue);
                                (e.target as HTMLInputElement).blur();
                            }
                        }}
                        className="w-16 bg-white dark:bg-google-dark-bg border border-slate-300 dark:border-google-dark-border rounded px-1 py-0.5 text-right text-xs text-slate-900 dark:text-white focus:border-google-blue outline-none"
                    />
                    <span className="text-slate-500 w-4">{angleUnit === 'deg' ? '°' : 'rad'}</span>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500 w-8 text-right">{displayMin.toFixed(1)}</span>
                <input
                    type="range"
                    min={displayMin}
                    max={displayMax}
                    step={step}
                    value={displayValue}
                    onChange={(e) => {
                        const newVal = parseFloat(e.target.value);
                        const radVal = angleUnit === 'deg' ? newVal * Math.PI / 180 : newVal;
                        handleJointAngleChange(name, radVal);
                    }}
                    onMouseUp={(e) => {
                        const newVal = parseFloat((e.target as HTMLInputElement).value);
                        const radVal = angleUnit === 'deg' ? newVal * Math.PI / 180 : newVal;
                        handleJointChangeCommit(name, radVal);
                    }}
                    onTouchEnd={(e) => {
                        const newVal = parseFloat((e.target as HTMLInputElement).value);
                        const radVal = angleUnit === 'deg' ? newVal * Math.PI / 180 : newVal;
                        handleJointChangeCommit(name, radVal);
                    }}
                    className="flex-1 h-1 bg-slate-300 dark:bg-google-dark-border rounded-lg appearance-none cursor-pointer accent-google-blue"
                />
                <span className="text-[10px] text-slate-500 w-8">{displayMax.toFixed(1)}</span>
            </div>
        </div>
    );
};
