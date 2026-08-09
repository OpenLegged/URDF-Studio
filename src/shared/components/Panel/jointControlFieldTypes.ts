import type { Dispatch, RefObject, SetStateAction } from 'react';

export interface EditableJointNumberField {
  inputRef: RefObject<HTMLInputElement | null>;
  inputValue: string;
  setInputValue: Dispatch<SetStateAction<string>>;
  isEditing: boolean;
  beginEditing: () => void;
  commit: (value: string) => void;
}
