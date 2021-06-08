// externals
import { Readable, writable } from 'svelte/store'
import { onDestroy, onMount } from 'svelte'
// locals
import { Operation, GraphQLTagResult, SubscriptionSpec, QueryArtifact } from './types'
import cache from './cache'
import { setVariables } from './context'
import { executeQuery } from './network'

// @ts-ignore: this file will get generated and does not exist in the source code
import { getSession } from './adapter.mjs'

export default function query<_Query extends Operation<any, any>>(
	document: GraphQLTagResult
): QueryResponse<_Query['result'], _Query['input']> {
	// make sure we got a query document
	if (document.kind !== 'HoudiniQuery') {
		throw new Error('query() must be passed a query document')
	}

	let variables = document.variables

	// embed the variables in the components context
	setVariables(() => variables)

	// dry the reference to the initial value
	const initialValue = document.initialValue.data

	// define the store we will hold the data
	const store = writable(initialValue)

	// we might get the the artifact nested under default
	const artifact: QueryArtifact =
		// @ts-ignore: typing esm/cjs interop is hard
		document.artifact.default || document.artifact

	// pull out the writer for internal use
	let subscriptionSpec: SubscriptionSpec | null = {
		rootType: artifact.rootType,
		selection: artifact.selection,
		set: store.set,
	}

	// when the component mounts
	onMount(() => {
		// update the cache with the data that we just ran into
		cache.write(artifact.selection, initialValue, variables)

		// stay up to date
		if (subscriptionSpec) {
			cache.subscribe(subscriptionSpec, variables)
		}
	})

	// the function used to clean up the store
	onDestroy(() => {
		subscriptionSpec = null
		cache.unsubscribe(
			{
				rootType: artifact.rootType,
				selection: artifact.selection,
				set: store.set,
			},
			variables
		)
	})

	const sessionStore = getSession()

	function writeData(newData: _Query['result'], newVariables: _Query['input']) {
		variables = newVariables || {}

		// make sure we list to the new data
		if (subscriptionSpec) {
			cache.subscribe(subscriptionSpec, variables)
		}

		// write the data we received
		cache.write(artifact.selection, newData.data, variables)
	}

	return {
		// the store should be read-only from the caller's perspective
		data: { subscribe: store.subscribe },
		// the refetch function can be used to refetch queries possibly with new variables/arguments
		async refetch(newVariables?: _Query['input']) {
			try {
				// Use the initial/previous variables
				let variableBag = variables

				// If new variables are set spread the new variables over the previous ones.
				if (newVariables) {
					variableBag = { ...variableBag, ...newVariables }
				}

				// Execute the query
				const result = await executeQuery(artifact, variableBag, sessionStore)

				// Write the data to the cache
				writeData(result, variableBag)
			} catch (error) {
				throw error
			}
		},
		// used primarily by the preprocessor to keep local state in sync with
		// the data given by preload
		writeData,
	}
}

// we need to wrap the response from a query in something that we can
// use as a proxy to the query for refetches, writing to the cache, etc
type QueryResponse<_Data, _Input> = {
	data: Readable<_Data>
	writeData: (data: _Data, variables: _Input) => void
	refetch: (newVariables?: _Input) => Promise<void>
}

// we need something we can replace the call to query that the user invokes
// it justs needs to pass through since we'll give it a reference to a hoisted query
export const getQuery = <T>(arg: T): T => arg
