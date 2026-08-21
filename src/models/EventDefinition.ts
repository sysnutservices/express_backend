import mongoose from "mongoose";

const EventDefinitionSchema = new mongoose.Schema({
    key: { type: String, unique: true, required: true }, // payment.success
    enabled: { type: Boolean, default: true }
});

export default mongoose.model("EventDefinition", EventDefinitionSchema);
