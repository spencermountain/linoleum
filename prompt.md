I'm really enamoured with the ability to query a remote parquet file, right from the client side, using duckdb-wasm. It's incredible that you can create a single compressed file, put it on an S3 bucket, and query it like it's a full database, taking a little sips of the file as needed. I feel really strongly about keeping websites small, and insisting that back-ends are static files whenever possible. 

I'm trying to think of a solution that does not involve loading a huge wasm database blob. This seems to be  overkill for many situations, particularly when the user only makes a very simple query to the remote file. A full database engine on the clientside is not necessary. 

My original plan was to make a lightweight JavaScript Parquet reader for this situation, but the more I learn about the details of this format, the more I learn how complex it is to parse, and how many dependencies this would require.

Instead, I'd like to experiment with creating a lightweight alternative to the Parquet file format. Something built explicitly for being used on a webpage, with remote file being probed in an efficient way with the content-range header. 

The goal of this project is to keep the number of bits transferred to the client side at a minimum. A user of this library can design their data set ahead of time to be very efficiently parsed by their users in this manner.

Like parquet, I would like the data to be placed into chunks, and a initial index that is loaded upfront, that tells the client where each chunk is in the file.
I'd like the index to be at the top of the file, and the size of this index to be hardcoded into specific byte ranges as sm, md, lg, or xl. The user must know which size the index is, before using it.
This hardcoded index size can be considered an opportunity, as the library knows exactly how much space it has to build an index, and it can do the reasoning down from that. It's not necessary to use the entire space, but it's possible to use it for things like compression dictionaries, or secondary indexes, or to ship smaller more detailed chunks. The reason I want the index size to be hardcoded is that I want the initial index fetch to not require any back+forth handshaking.


What I'm imagining is this - there are two parts of this javascript library - one to build this file format ahead of time, and another small one to use it with a query from a webpage. Ideally, both sides can be used on the client side or the server side isometrically, if possible, but typically the user creates this file ahead of time in nodejs

```js 
import {makeFile, readFile} from 'linoleum'

# ahead of time
let lino = makeFile()
lino.schema([{id:'foo', type:'boolean'},{id:'bar', type:'string'},{id:'extra', tupe:'string', index:false}])
lino.rows(rows)
const data = lino.burn('md')
fs.writefileSync('myfile-md.lino', data)

# user on hot-path
let lino = await readFile(myUrl, 'md')

let data = lino.get({foo:true, bar:'baz'})
```

Given that the goal of this project is to minimize the number of bytes across the wire, the main way to do this should be to reduce the number of chunks that the user must request. This is done by producing a minimum and maximum value for each indexed column in each chunk. Once the user has this index, they should be able to reason about which chunks need to be fetched to satisfy their query.
When the user designs their schema, they should do so, in order of index priority. The first column should be sorted first, and the second column should be sorted second. This should be done very intentionally by the user, as it will have a big impact on how efficiently the file can be queried. If a user does not want a column to be included in the index, they can pass index:false, And the Index will not include minimum and maximum values for this column. This should signal that this data is extra, and not meant to be queried.

Because this schema must be designed artfully, I would like the client side readfile method to keep analytics about how much of the file it has downloaded to satisfy the query. This can help users design their schema efficiently. 

I would like some type of compression to be used in this file format, and I like how well column-oriented compression works in parquet. The most important feature though, is that the user can make efficient small reads of the file. It's really not central that the file itself is small. There's nothing wrong with a large file, if a user only needs to make a few small reads to it.

Lastly, the query language should be very simple json-based matching, and does not need any sql-like features. I'm thinking of a similar syntax that i've seen in mongodb
```js
// match all foo==='bar'
lino.get({foo:'bar'})
// greater-than or equal 4
lino.get({baz:{'$gte': 4}})
// not equal 4
lino.get({baz:{'$ne': 4}})
```

This is all I've come up with, but I would welcome some feedback on the ideas. Please consider the idea experimental, and an opportunity to learn. I'm open to your suggestions and ideas.
If it works, it could be used to create very fast and efficient web interfaces on large data sets.
