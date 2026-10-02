import { decideAction } from "./solver.js";
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, action: decideAction(data.state, data.incoming) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message }); }
};
