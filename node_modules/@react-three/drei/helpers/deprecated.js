/**
 * Sets `BufferAttribute.updateRange` since r159.
 */
const setUpdateRange = (attribute, updateRange) => {
  attribute.updateRanges[0] = updateRange;
};

export { setUpdateRange };
