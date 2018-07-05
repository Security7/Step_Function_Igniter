let aws = require('aws-sdk');
let request = require('request');

//
//	Create a Lambda object for invocation
//
let lambda = new aws.Lambda({
	region: process.env.AWS_REGION
});

//
//  This function is responsabile for programmatically manage the creation
//  of a CloudFormation stack. This means that while the stack is beeing 
//  created we can do certains action automatically.
//
//      EXAMPLE
//
//          Start a Step Function Automatically after it is created.
//
exports.handler = async (event, context) => {
	
    //
	//	1.	Create a container that will be passed around the chain.
	//
	let container = {
		//
		//  A collection of information that we need to be able to talk with CF
		//
		log_stream_name: context.logStreamName,
		stack_id: event.StackId,
		request_id: event.RequestId,
		request_type: event.RequestType,
		logical_resource_id: event.LogicalResourceId,
		step_function_arn: event.ResourceProperties.step_function_arn,
		stack_name: event.ResourceProperties.stack_name,
		response_url: event.ResponseURL,
		//
		//	The default response data for CloudFormation.
		//
		res: {
		    result: "SUCCESS"
		}
	};
	
    //
	//	->	Start the chain.
	//
	try 
	{
		container = await start_step_function(container);
		container = await notify_cloudformation(container);
	}
	catch(error)
	{
		//
		//	<>> Put the detail in the logs for easy debugging
		//
		console.log(error);
        
        //
        //  1.  Switch the status from OK to Error. This way CF knows that
        //      something went wrong.
        //
        container.res.result = 'FAILED';
        
		//
		//  ->  Notify CF
		//
		await notify_cloudformation(container);
	}

	//
	//	->	Return a positive response
	//
	return "Done!";
};

//
//  We can start our step function. No need to stop it since when you delete 
//  the stack the SF will be deelted and automatically stoped.
//  
function start_step_function(container)
{
    return new Promise(function(resolve, reject) {
        
        //
        //  1.  Skip this Promise if it is not a Create event. We want to 
        //      start the Step Function only when we are creating a stack.
        //
        if(container.request_type != 'Create')
        {
			//
			//	->	Move to the next promise.
			//
			return resolve(container);
        }
        
        //
        //  2.  Prepare the data for the invocation
        //
        let data = JSON.stringify({
            step_function_arn: container.step_function_arn,
            loop_count: 0,
            loop_limit: process.env.LOOP_LIMIT
        });
        
        //
    	//	3.	Prepare the Lambda Invocation with all the data that needs to 
    	//      be passed to the Lambda to sucesfully send the email.
    	//
    	var params = {
    		FunctionName: 'Restart-' + container.stack_name,
    		Payload: data,
    	};
    
    	//
    	//	4.	Invoke the Lambda Function
    	//
    	lambda.invoke(params, function(error, data) {
    
    		//
    		//	1.	Check if there was an error in invoking the fnction
    		//
    		if(error)
    		{
    			return reject(error);
    		}
    
    		//
    		//	2.	Check if there was an error
    		//
    		if(data.StatusCode >= 300)
    		{
    			//
    			//	->	Stop here and surface the error
    			//
    			return reject(new Error("Invocation Failed."));
    		}
    
    		//
        	//  ->  Move to the next promise
        	//
        	return resolve(container);
    
    	});
	
    });
}

//
//  After all is done, we can ping CloudFormation and let it know that we are 
//  done doing our custom job.
//
function notify_cloudformation(container)
{
	return new Promise(function(resolve, reject) {
        
        //
        //  1.  Create the body of the request and pass all the necesary data
        //      to CloudFormation to let it know how our execution went.
        //
        let body = JSON.stringify({
            Status: container.res.result,
            Reason: "See the details in CloudWatch Log Stream: " + container.log_stream_name,
            PhysicalResourceId: container.log_stream_name,
            StackId: container.stack_id,
            RequestId: container.request_id,
            LogicalResourceId: container.logical_resource_id,
            NoEcho: false,
            Data: {}
        });

		//
		// 	2.  Prepare all the options for the request.
		//
		let options = {
			url: container.response_url,
			headers: {
				'content-type': ""
			},
			body: body
		};

		//
		//  -> Execute the request.
		//
		request.put(options, function(error, res, body) {
			
			//
			//  1.  Check if there was an internal error.
			//
			if(error)
			{
				return reject(error);
			}
	
			//
			//	3.	Check if we are makign to many requests
			//
			if(res.statusCode >= 300)
			{
				//
				//	1.	Set the message
				//	
				let error = new Error("Something went wrong");
					
				//
				//	2.	Pass the Status Code nr for easier debugging
				//
				error.status = res.statusCode;
					
				//
				//	->	Stop execution and surface the error
				//
				return reject(error);
			}
	
			//
			//	->	Move to the next chain
			//
			return resolve(container);

		});
	});
}