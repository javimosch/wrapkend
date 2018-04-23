import {
  createPaginationMethod
} from '../helpers/mongoPagination';
var mongoosePaginate = require('mongoose-paginate');
const mongoose = require('mongoose');
import sequential from 'promise-sequential';
import moment from 'moment'

export const schema = new mongoose.Schema({
  name:{
    type:String,
    required:true
  },
  description:String,
  type:{
    type:String,
    enum:['Number','String','Boolean','Date','Ref'],
    default:String,
    required:true
  },
  ref:String,
  index:Boolean,
  required:Boolean,
  unique:Boolean,
  enum:[String],
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'tae_user'
  }
}, {
  timestamps: true,
  toObject: {}
});


schema.options.toObject.transform = function(doc, ret) {
  return ret;
};

schema.statics.findPaginate = createPaginationMethod()
schema.plugin(mongoosePaginate);
const WraCollectionField = mongoose.model('wra_collection_field', schema);
export default WraCollectionField;
