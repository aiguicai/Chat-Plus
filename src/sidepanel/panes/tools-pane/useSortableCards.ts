import type { DropResult } from "@hello-pangea/dnd";

export function resolveSortableMove(result: DropResult) {
  const { draggableId, source, destination } = result;
  if (!destination || destination.index === source.index) {
    return null;
  }

  return {
    activeId: draggableId,
    targetIndex: destination.index,
  };
}
